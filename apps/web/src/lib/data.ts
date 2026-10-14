import type { ArticleList, Bundle, BundleIndex, Claim } from "@antibody/core";

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

/** The claims sidecar of one bill, or the claims inside its bundle when it has no sidecar. */
export async function loadClaims(id: string): Promise<Record<string, Claim>> {
  const index = await loadIndex();
  const entry = index.bills.find((b) => b.id === id);
  if (entry?.claimsFile) return load<Record<string, Claim>>(`/bundles/${entry.claimsFile}`);
  return (await loadBundle(id))?.claims ?? {};
}

/** Every news article counted for a bill's sections, or null when the bill has no list. */
export async function loadArticles(id: string): Promise<ArticleList | null> {
  const entry = (await loadIndex()).bills.find((b) => b.id === id);
  return entry?.articlesFile ? load<ArticleList>(`/bundles/${entry.articlesFile}`) : null;
}
