import { createHash } from "node:crypto";
import type { BillId, Row } from "@antibody/core";
import { OUTLET_LIST, OUTLETS, SIDES, type Side, sideOf } from "@antibody/ingest-news";
import type { Match, MatchRun } from "./match.ts";

export const ATTENTION_RULE =
  "attention-v1: a section's attention is the share of each side's sampled articles about the bill that discuss it " +
  "(left, center and right weighted equally, from the published outlet list), ranked against the bill's other final sections; " +
  "a bill with fewer than 20 relevant articles or 30 section mentions shows raw counts and no rank";

/** Below this many sampled, relevant articles a bill's percentiles are not shown. */
export const MIN_ARTICLES = 20;
/**
 * An article with less text than this (a paywall stub, a failed fetch, a headline) is not counted: a matcher cannot
 * tell which sections it covers, and outlets differ in how much of their text a script can read, so counting them
 * would shrink one side's attention for reasons that have nothing to do with the bill.
 */
export const MIN_TEXT_CHARS = 1000;
/**
 * Below this many section mentions in total, a section's rank is mostly chance (a handful of articles spread over
 * hundreds of sections), so the bill gets raw counts and no percentiles.
 */
export const MIN_SECTION_HITS = 30;
/** A side with fewer relevant, readable articles than this is left out of the equal weighting and named as a gap. */
export const MIN_SIDE_ARTICLES = 10;
const EXAMPLES = 3;
const SIDE_NAMES = Object.keys(SIDES) as Side[];

type Group = Row<"outlets">["group"];
const groupOf = new Map(OUTLETS.map((o) => [o.domain, o.group] as [string, Group]));

/**
 * Percent rank within `reference`: the share of the other values strictly below v, so uncovered sections all rank 0.
 * A dropped section is ranked against the final ones, so it can be above all of them: that is 1.
 */
export function percentile(v: number, reference: number[]): number {
  if (reference.length < 2) return 0.5;
  return Math.min(1, reference.filter((r) => r < v).length / (reference.length - 1));
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex");

export interface AttentionResult {
  rows: Row<"attention">[];
  /** Balanced share per section id, for the score. */
  share: Map<string, number>;
  relevant: number;
  /** The relevant articles from counted outlets: the pool a section's attention is a share of. */
  counted: Row<"articles">[];
  /** The balanced share of the given counted articles (each weighted side counts equally), as for a section's hits. */
  shareOf: (articleIds: Iterable<string>) => number;
}

export function attention(
  bill: BillId,
  sections: Row<"sections">[],
  articles: Row<"articles">[],
  run: MatchRun,
): AttentionResult {
  const read = articles.filter((a) => (a.text_chars ?? 0) >= MIN_TEXT_CHARS && run.matches[a.id]);
  const match = (a: Row<"articles">) => run.matches[a.id] as Match;
  const relevant = read.filter((a) => match(a).about !== "unrelated");
  const counted = relevant.filter((a) => a.outlet_id && sideOf(groupOf.get(a.outlet_id)!));
  const trade = relevant.filter((a) => a.outlet_id && groupOf.get(a.outlet_id) === "trade-legal");
  const side = (a: Row<"articles">) => sideOf(groupOf.get(a.outlet_id!)!)!;

  const perSide = Object.fromEntries(SIDE_NAMES.map((s) => [s, counted.filter((a) => side(a) === s).length])) as Record<
    Side,
    number
  >;
  const found = Object.fromEntries(
    SIDE_NAMES.map((s) => [s, articles.filter((a) => a.outlet_id && sideOf(groupOf.get(a.outlet_id)!) === s).length]),
  );
  const sampled = Object.fromEntries(
    SIDE_NAMES.map((s) => [s, read.filter((a) => a.outlet_id && sideOf(groupOf.get(a.outlet_id)!) === s).length]),
  );
  const fetched = Object.fromEntries(
    SIDE_NAMES.map((s) => [
      s,
      articles.filter((a) => a.text_chars !== null && a.outlet_id && sideOf(groupOf.get(a.outlet_id)!) === s).length,
    ]),
  );
  const activeSides = SIDE_NAMES.filter((s) => perSide[s] >= MIN_SIDE_ARTICLES);

  const balanced = (hitters: Row<"articles">[]) => {
    if (!activeSides.length) return 0;
    let sum = 0;
    for (const s of activeSides) sum += hitters.filter((a) => side(a) === s).length / perSide[s];
    return sum / activeSides.length;
  };

  const hitsFor = (pred: (m: Match) => boolean) => ({
    counted: counted.filter((a) => pred(match(a))),
    trade: trade.filter((a) => pred(match(a))),
  });

  const examples = (hitters: Row<"articles">[]) => {
    const bySide = SIDE_NAMES.map((s) =>
      hitters
        .filter((a) => side(a) === s)
        .sort(
          (a, b) =>
            ((b.text_chars ?? 0) > 0 ? 1 : 0) - ((a.text_chars ?? 0) > 0 ? 1 : 0) || (hash(a.id) < hash(b.id) ? -1 : 1),
        ),
    );
    const out: string[] = [];
    for (let i = 0; out.length < EXAMPLES && bySide.some((l) => l[i]); i++)
      for (const l of bySide) if (l[i] && out.length < EXAMPLES) out.push(l[i]!.id);
    return out;
  };

  const byGroup = (hitters: Row<"articles">[]) => {
    const g: Partial<Record<Group, number>> = {};
    for (const a of hitters) {
      const k = groupOf.get(a.outlet_id!)!;
      g[k] = (g[k] ?? 0) + 1;
    }
    return g;
  };

  const final = sections.filter((s) => s.in_final);
  const mentions = final.reduce((n, s) => n + hitsFor((m) => m.sections.includes(s.id)).counted.length, 0);
  const thin = counted.length < MIN_ARTICLES || mentions < MIN_SECTION_HITS;
  const share = new Map(
    sections.map((s) => [s.id, balanced(hitsFor((m) => m.sections.includes(s.id)).counted)] as [string, number]),
  );
  const reference = final.map((s) => share.get(s.id)!);

  const evidenceBase = {
    matcher: run.matcher,
    model: run.model,
    outlet_list_version: OUTLET_LIST.version,
    via: [...new Set(articles.map((a) => a.via))],
    found_by_side: found,
    sampled_by_side: fetched,
    readable_by_side: sampled,
    sides_weighted: activeSides,
    relevant_by_side: perSide,
    relevant_trade_legal: trade.length,
  };

  const rows: Row<"attention">[] = sections.map((s) => {
    const h = hitsFor((m) => m.sections.includes(s.id));
    return {
      id: `${bill}:${s.id}`,
      bill_id: bill,
      section_id: s.id,
      hits: h.counted.length,
      hits_by_group: byGroup(h.counted),
      trade_legal_hits: h.trade.length,
      pct: thin ? null : Number(percentile(share.get(s.id)!, reference).toFixed(4)),
      example_article_ids: examples(h.counted),
      rule: ATTENTION_RULE,
      confidence: thin ? 0.4 : 0.75,
      rests_on: h.counted.length
        ? h.counted.map((a) => `articles/${a.id}`)
        : [`sections/${s.id}`, ...counted.slice(0, 1).map((a) => `articles/${a.id}`)],
      evidence: { ...evidenceBase, balanced_share: Number(share.get(s.id)!.toFixed(5)), in_final: s.in_final },
    };
  });

  const general = hitsFor((m) => m.whole || m.outside !== null);
  const outside: Record<string, number> = {};
  for (const a of general.counted) {
    const o = match(a).outside;
    if (o) outside[o] = (outside[o] ?? 0) + 1;
  }
  rows.push({
    id: `${bill}:general`,
    bill_id: bill,
    section_id: null,
    hits: general.counted.length,
    hits_by_group: byGroup(general.counted),
    trade_legal_hits: general.trade.length,
    pct: null,
    example_article_ids: examples(general.counted),
    rule: ATTENTION_RULE,
    confidence: thin ? 0.4 : 0.75,
    rests_on: general.counted.length ? general.counted.map((a) => `articles/${a.id}`) : [`bills/${bill}`],
    evidence: {
      ...evidenceBase,
      relevant: counted.length,
      outside_topics: Object.entries(outside)
        .sort((a, b) => b[1] - a[1])
        .map(([topic, n]) => ({ topic, articles: n })),
    },
  });
  const shareOf = (ids: Iterable<string>) => {
    const wanted = new Set(ids);
    return balanced(counted.filter((a) => wanted.has(a.id)));
  };
  return { rows, share, relevant: counted.length, counted, shareOf };
}
