import type { Bundle, BundleIndex, Claim } from "@antibody/core";
import { useCallback, useSyncExternalStore } from "react";

interface Cached<K, T> {
  (key: K): Promise<T>;
  peek: (key: K) => T | undefined;
}

function cachedBy<K, T>(start: (key: K) => Promise<T>): Cached<K, T> {
  const pending = new Map<K, Promise<T>>();
  const done = new Map<K, T>();

  // oxlint-disable-next-line typescript/promise-function-async -- returns the cached promise itself, so React's use() sees the same thenable on every render
  const get = (key: K): Promise<T> => {
    let p = pending.get(key);

    if (!p) {
      p = start(key).then((value) => {
        done.set(key, value);

        return value;
      });
      p.catch(() => pending.delete(key));
      pending.set(key, p);
    }

    return p;
  };

  return Object.assign(get, { peek: (key: K) => done.get(key) });
}

function useLoaded<K, T>(source: Cached<K, T>, key: K | null): T | undefined {
  const subscribe = useCallback(
    (notify: () => void) => {
      let live = true;

      if (key !== null) {
        source(key)
          .finally(() => {
            if (live) {
              notify();
            }
          })
          .catch(() => null);
      }

      return () => {
        live = false;
      };
    },
    [source, key],
  );

  return useSyncExternalStore(subscribe, () => (key === null ? undefined : source.peek(key)));
}

async function published<T extends BundleIndex | Bundle | Record<string, Claim>>(url: string): Promise<T> {
  const r = await fetch(url);

  if (!r.ok) {
    throw new Error(`${r.status} ${url}`);
  }

  // SAFETY: store validates every published file with zod; claims files run to 30 MB, too big to parse again in a browser.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
  return (await r.json()) as T;
}

const INDEX = "/bundles/index.json";
const indexAt = cachedBy(async (url: string) => await published<BundleIndex>(url));

// oxlint-disable-next-line typescript/promise-function-async -- returns the cached promise itself, so React's use() sees the same thenable on every render
export const loadIndex = (): Promise<BundleIndex> => indexAt(INDEX);

export const useIndex = () => useLoaded(indexAt, INDEX);

export const loadBundle = cachedBy(async (id: string): Promise<Bundle | null> => {
  const entry = (await loadIndex()).bills.find((b) => b.id === id);

  return entry ? await published<Bundle>(`/bundles/${entry.file}`) : null;
});

export const prefetchBundle = (id: string) => {
  loadBundle(id).catch(() => null);
};

export const loadClaims = cachedBy(async (id: string): Promise<Record<string, Claim> | null> => {
  try {
    const file = (await loadIndex()).bills.find((b) => b.id === id)?.claimsFile ?? "";

    return file === "" ? null : await published<Record<string, Claim>>(`/bundles/${file}`);
  } catch {
    return null;
  }
});

export const useClaimsFile = (id: string | null) => useLoaded(loadClaims, id);
