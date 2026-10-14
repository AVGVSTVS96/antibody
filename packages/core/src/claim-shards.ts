import type { ClaimShards } from "./bundle.ts";
import type { Claim } from "./claim.ts";

/**
 * How a published bundle's claims are split into files so a reader fetches only the ones a source chip or receipt
 * needs. Claim ids sorted, cut into runs of about `CLAIM_SHARD_BYTES`: ids that sit together (a table's rows, one
 * vote, one filing) share a file, and a lookup is a binary search over the first id of each run.
 * No zod here: the web app imports this file.
 */
export const CLAIM_SHARD_BYTES = 128_000;

export const claimShardFile = (billId: string, shard: number) => `${billId}.claims.${shard}.json`;

const claimTable = (id: string) => id.slice(0, id.indexOf("/"));

/** The shard that holds `id` if any shard does, else -1. */
export function claimShardOf({ starts }: ClaimShards, id: string): number {
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid]! <= id) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

export function shardClaims(
  claims: Record<string, Claim>,
  bytes = CLAIM_SHARD_BYTES,
): { manifest: ClaimShards; shards: Record<string, Claim>[] } {
  const shards: Record<string, Claim>[] = [];
  const starts: string[] = [];
  const kinds: ClaimShards["kinds"] = {};
  let size = bytes;
  for (const id of Object.keys(claims).sort()) {
    const claim = claims[id]!;
    if (size >= bytes) {
      shards.push({});
      starts.push(id);
      size = 0;
    }
    shards.at(-1)![id] = claim;
    size += JSON.stringify(claim).length;
    const table = claimTable(id);
    kinds[table] = kinds[table] && kinds[table] !== claim.kind ? "mixed" : claim.kind;
  }
  return { manifest: { starts, kinds }, shards };
}
