import type { Bundle, Claim, ClaimId } from "@antibody/core";

export const EDGE_CLAIM_CAP = 6;

export function trimEvidence(b: Bundle, cap = EDGE_CLAIM_CAP): Bundle {
  for (const e of b.edges) {
    if (e.claims.length <= cap) {
      continue;
    }

    const sorted = e.claims.toSorted();
    const inference = sorted.filter((c) => b.claims[c]?.kind === "inference").slice(0, 2);
    const rest = sorted.filter((c) => !inference.includes(c));
    const kept = [...inference, ...rest].slice(0, cap);
    e.moreClaims = e.claims.length - kept.length;
    e.claims = kept;
  }

  b.claims = reachable(b);

  return b;
}

function reachable(b: Bundle): Record<ClaimId, Claim> {
  const claims = new Map<unknown, [ClaimId, Claim]>(Object.entries(b.claims).map((entry) => [entry[0], entry]));
  const reached = new Map<ClaimId, Claim>();
  const queue: Claim[] = [];

  const take = (ids: unknown[]) => {
    for (const ref of ids) {
      const found = claims.get(ref);

      if (found && !reached.has(found[0])) {
        reached.set(...found);
        queue.push(found[1]);
      }
    }
  };

  const walk = (entries: [string, unknown][]) => {
    for (const [k, x] of entries) {
      if (k === "claim" || k === "claims" || k.endsWith("Claim")) {
        take([x].flat());
      }

      if (x instanceof Object) {
        walk(Object.entries(x));
      }
    }
  };

  walk(Object.entries(b).filter(([k]) => k !== "claims"));

  for (let claim = queue.pop(); claim; claim = queue.pop()) {
    take(claim.restsOn);
  }

  return Object.fromEntries(reached);
}
