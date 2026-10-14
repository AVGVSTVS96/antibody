import type { Bundle, Claim, ClaimId } from "@antibody/core";

export const EDGE_CLAIM_CAP = 8;

/**
 * Keeps a bounded set of claims on each edge and drops every claim nothing points at. A lobbying edge can rest on
 * hundreds of filings and a funding edge on thousands of contributions; the edge's props carry the totals,
 * `moreClaims` says how many are not listed, and the kept claims link to the source records.
 * Inference claims come first, so an inference edge always shows its rule.
 */
export function trimEvidence(b: Bundle, cap = EDGE_CLAIM_CAP): Bundle {
  for (const e of b.edges) {
    if (e.claims.length <= cap) continue;
    const inference = e.claims.filter((c) => b.claims[c]?.kind === "inference").slice(0, 2);
    const rest = e.claims.filter((c) => !inference.includes(c));
    const kept = [...inference, ...rest].slice(0, cap);
    e.moreClaims = e.claims.length - kept.length;
    e.claims = kept;
  }
  b.claims = reachable(b);
  return b;
}

/** The claims some part of the bundle points at, directly or through another claim's `restsOn`. */
function reachable(b: Bundle): Record<ClaimId, Claim> {
  const seen = new Set<ClaimId>();
  const queue: ClaimId[] = [];
  const take = (id: unknown) => {
    if (typeof id === "string" && id in b.claims && !seen.has(id)) {
      seen.add(id);
      queue.push(id);
    }
  };
  const walk = (v: unknown, top: boolean) => {
    if (Array.isArray(v)) for (const x of v) walk(x, false);
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if (top && k === "claims") continue;
        if (k === "claim" || k === "claims" || k.endsWith("Claim")) for (const id of [x].flat()) take(id);
        walk(x, false);
      }
  };
  walk(b, true);
  for (let id = queue.pop(); id; id = queue.pop()) for (const r of b.claims[id]!.restsOn) take(r);
  return Object.fromEntries([...seen].map((id) => [id, b.claims[id]!]));
}
