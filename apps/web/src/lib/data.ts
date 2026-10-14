import type { Bundle, BundleIndex, Claim } from "@antibody/core";
import { claimShardFile, claimShardOf } from "@antibody/core/claim-shards";

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

/**
 * The claims in the shards that hold `ids` (all of each shard, since it is downloaded anyway), or the bundle's own
 * claims when it has no shards. A shard is fetched once; an id no shard holds is simply absent from the result.
 */
export async function loadClaims(bundle: Bundle, ids: readonly string[]): Promise<Record<string, Claim>> {
  const { claimShards, claims } = bundle;
  if (!claimShards) return claims;
  const files = new Set(ids.map((id) => claimShardOf(claimShards, id)).filter((shard) => shard >= 0));
  const shards = await Promise.all(
    [...files].map((shard) => load<Record<string, Claim>>(`/bundles/${claimShardFile(bundle.bill.id, shard)}`)),
  );
  return Object.assign({}, ...shards);
}
