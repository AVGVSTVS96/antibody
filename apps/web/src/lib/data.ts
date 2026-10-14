import type { Bundle, BundleIndex } from "@antibody/core";

/**
 * Bundles are validated when store publishes them (and in this app's tests), so the browser reads them as typed JSON
 * and never ships zod.
 */
const cache = new Map<string, Promise<unknown>>();

function load<T>(url: string): Promise<T> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return r.json();
    });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p as Promise<T>;
}

export const loadIndex = () => load<BundleIndex>("/bundles/index.json");

export async function loadBundle(id: string): Promise<Bundle | null> {
  const index = await loadIndex();
  const entry = index.bills.find((b) => b.id === id);
  return entry ? load<Bundle>(`/bundles/${entry.file}`) : null;
}

export const prefetchBundle = (id: string) => void loadBundle(id).catch(() => {});
