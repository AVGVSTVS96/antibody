import type { Bundle, BundleIndex, Claim } from "@antibody/core";

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

const bundles = new Map<string, Promise<Bundle | null>>();

/** One promise per bill, so React's `use` sees the same thenable on every render. */
export function loadBundle(id: string): Promise<Bundle | null> {
  let p = bundles.get(id);
  if (!p) {
    p = loadIndex().then((index) => {
      const entry = index.bills.find((b) => b.id === id);
      return entry ? load<Bundle>(`/bundles/${entry.file}`) : null;
    });
    p.catch(() => bundles.delete(id));
    bundles.set(id, p);
  }
  return p;
}

export const prefetchBundle = (id: string) => void loadBundle(id).catch(() => {});

export async function loadClaims(id: string): Promise<Record<string, Claim> | null> {
  const index = await loadIndex();
  const entry = index.bills.find((b) => b.id === id);
  return entry?.claimsFile ? load<Record<string, Claim>>(`/bundles/${entry.claimsFile}`) : null;
}
