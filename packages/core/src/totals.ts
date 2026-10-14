import { z } from "zod";
import type { Bundle } from "./bundle.ts";

/**
 * Counts across all the index's bills where a record can appear in several, each counted once: a trade tied to two
 * bills, or a PAC's gifts to a member who sits behind two bills, is one trade and one pair, not two.
 */
export const IndexTotals = z.object({
  bills: z.number().int(),
  /** Final sections, summed (a section belongs to one bill). */
  sections: z.number().int(),
  members: z.number().int(),
  membersTraded: z.number().int(),
  /** Distinct disclosed trade records tied to a bill's companies. */
  trades: z.number().int(),
  companies: z.number().int(),
  pacs: z.number().int(),
  /** Distinct PAC to member pairs with a gift in the bills' windows. */
  pacMemberPairs: z.number().int(),
});
export type IndexTotals = z.infer<typeof IndexTotals>;

export function indexTotals(bundles: Bundle[]): IndexTotals {
  const trades = new Set<string>();
  const traders = new Set<string>();
  const pairs = new Set<string>();
  const nodes = (kind: string) =>
    new Set(bundles.flatMap((b) => b.nodes.filter((n) => n.kind === kind).map((n) => n.id)));
  for (const b of bundles)
    for (const e of b.edges) {
      if (e.kind === "traded") {
        traders.add(e.src);
        for (const ev of e.props.events) trades.add(ev.claim);
      } else if (e.kind === "funded") pairs.add(`${e.src}>${e.dst}`);
    }
  return {
    bills: bundles.length,
    sections: bundles.reduce((n, b) => n + b.sections.filter((s) => s.inFinal).length, 0),
    members: nodes("member").size,
    membersTraded: traders.size,
    trades: trades.size,
    companies: nodes("company").size,
    pacs: nodes("pac").size,
    pacMemberPairs: pairs.size,
  };
}
