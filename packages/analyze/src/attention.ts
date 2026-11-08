import { createHash } from "node:crypto";
import type { BillId, Row } from "@antibody/core";
import { OUTLET_LIST, OUTLETS, SIDE_NAMES, sideOf } from "@antibody/ingest-news";
import type { Side } from "@antibody/ingest-news";
import type { Match, MatchRun } from "./match.ts";
import { NAMES_BILL } from "./score.ts";

export const ATTENTION_RULE =
  "attention-v2: a section's attention is the share of each side's sampled articles about the bill that discuss it " +
  "(left, center and right weighted equally, from the published outlet list), ranked against the bill's other final sections " +
  "that are more than its name (a short title or table of contents); sections tied with it count half, and a bill's only " +
  "such section ranks at the top once any article discusses it; " +
  "a bill with fewer than 20 relevant articles or 30 section mentions shows raw counts and no rank. " +
  "A part of a long section (parts-v1) is offered to the matcher on its own and ranked against the same sections; " +
  "an article that discusses a part discusses its section too";

export const MIN_ARTICLES = 20;

export const MIN_TEXT_CHARS = 1000;

export const MIN_SECTION_HITS = 30;

export const MIN_SIDE_ARTICLES = 10;
const EXAMPLES = 3;

type Group = Row<"outlets">["group"];

const groupOf = new Map(OUTLETS.map((o): [string, Group] => [o.domain, o.group]));

function sideOfOutlet(outletId: string | null): Side | null {
  const group = outletId === null || outletId === "" ? undefined : groupOf.get(outletId);

  return group === undefined ? null : sideOf(group);
}

const sideOfArticle = (a: Row<"articles">) => sideOfOutlet(a.outlet_id);

const bySide = (count: (side: Side) => number): Record<Side, number> => ({
  left: count("left"),
  center: count("center"),
  right: count("right"),
});

function byGroup(hitters: Row<"articles">[]) {
  const g: Partial<Record<Group, number>> = {};

  for (const a of hitters) {
    const k = a.outlet_id === null ? undefined : groupOf.get(a.outlet_id);

    if (k !== undefined) {
      g[k] = (g[k] ?? 0) + 1;
    }
  }

  return g;
}

export function percentile(v: number, reference: number[], inReference = true): number {
  if (v <= 0) {
    return 0;
  }

  const others = [...reference];
  const self = inReference ? others.indexOf(v) : -1;

  if (self >= 0) {
    others.splice(self, 1);
  }

  if (others.length === 0) {
    return 1;
  }

  const below = others.filter((r) => r < v).length;
  const tied = others.filter((r) => r === v).length;

  return Math.min(1, (below + tied / 2) / others.length);
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex");

function examples(hitters: Row<"articles">[]): string[] {
  const hittersBySide = SIDE_NAMES.map((s) =>
    hitters
      .filter((a) => sideOfArticle(a) === s)
      .toSorted(
        (a, b) =>
          ((b.text_chars ?? 0) > 0 ? 1 : 0) - ((a.text_chars ?? 0) > 0 ? 1 : 0) || (hash(a.id) < hash(b.id) ? -1 : 1),
      ),
  );

  const out: string[] = [];

  for (let i = 0; out.length < EXAMPLES && hittersBySide.some((l) => l[i] !== undefined); i++) {
    for (const l of hittersBySide) {
      const a = l[i];

      if (a !== undefined && out.length < EXAMPLES) {
        out.push(a.id);
      }
    }
  }

  return out;
}

export interface AttentionResult {
  rows: Row<"attention">[];
  share: Map<string, number>;
  relevant: number;
  counted: Row<"articles">[];
  shareOf: (articleIds: Iterable<string>) => number;
}

export function attention(
  bill: BillId,
  sections: Row<"sections">[],
  articles: Row<"articles">[],
  run: MatchRun,
  parts: Pick<Row<"section_parts">, "id" | "section_id">[] = [],
): AttentionResult {
  const partsOf = Map.groupBy(parts, (p) => p.section_id);

  const about = (m: Match, id: string) =>
    m.sections.includes(id) || (partsOf.get(id)?.some((p) => m.sections.includes(p.id)) ?? false);

  const read = articles.filter((a) => (a.text_chars ?? 0) >= MIN_TEXT_CHARS && run.matches[a.id] !== undefined);

  const match = (a: Row<"articles">): Match => {
    const m = run.matches[a.id];

    if (m === undefined) {
      throw new Error(`article ${a.id} has no match`);
    }

    return m;
  };

  const relevant = read.filter((a) => match(a).about !== "unrelated");
  const counted = relevant.filter((a) => sideOfOutlet(a.outlet_id) !== null);
  const trade = relevant.filter((a) => a.outlet_id !== null && groupOf.get(a.outlet_id) === "trade-legal");
  const perSide = bySide((s) => counted.filter((a) => sideOfArticle(a) === s).length);
  const found = bySide((s) => articles.filter((a) => sideOfArticle(a) === s).length);
  const sampled = bySide((s) => read.filter((a) => sideOfArticle(a) === s).length);
  const fetched = bySide((s) => articles.filter((a) => a.text_chars !== null && sideOfArticle(a) === s).length);

  const activeSides = SIDE_NAMES.filter((s) => perSide[s] >= MIN_SIDE_ARTICLES);

  const balanced = (hitters: Row<"articles">[]) => {
    if (activeSides.length === 0) {
      return 0;
    }

    let sum = 0;

    for (const s of activeSides) {
      sum += hitters.filter((a) => sideOfArticle(a) === s).length / perSide[s];
    }

    return sum / activeSides.length;
  };

  const hitsFor = (pred: (m: Match) => boolean) => ({
    counted: counted.filter((a) => pred(match(a))),
    trade: trade.filter((a) => pred(match(a))),
  });

  const final = sections.filter((s) => s.in_final);
  const inFinal = new Map(sections.map((s) => [s.id, s.in_final]));
  const mentions = final.reduce((n, s) => n + hitsFor((m) => about(m, s.id)).counted.length, 0);
  const thin = counted.length < MIN_ARTICLES || mentions < MIN_SECTION_HITS;

  const share = new Map([
    ...sections.map((s): [string, number] => [s.id, balanced(hitsFor((m) => about(m, s.id)).counted)]),
    ...parts.map((p): [string, number] => [p.id, balanced(hitsFor((m) => m.sections.includes(p.id)).counted)]),
  ]);

  const shareFor = (id: string) => {
    const v = share.get(id);

    if (v === undefined) {
      throw new Error(`no attention share for ${id}`);
    }

    return v;
  };

  const reference = final.flatMap((s) => (NAMES_BILL.test(s.heading.trim()) ? [] : [shareFor(s.id)]));

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

  const row = (
    id: string,
    sectionId: string,
    partId: string | null,
    isFinal: boolean,
    own: boolean,
  ): Row<"attention"> => {
    const h = hitsFor((m) => (own ? m.sections.includes(id) : about(m, id)));
    const isPart = partId !== null && partId !== "";

    return {
      id: `${bill}:${id}`,
      bill_id: bill,
      section_id: sectionId,
      part_id: partId,
      hits: h.counted.length,
      hits_by_group: byGroup(h.counted),
      trade_legal_hits: h.trade.length,
      pct: thin ? null : Number(percentile(shareFor(id), reference, !isPart).toFixed(4)),
      example_article_ids: examples(h.counted),
      rule: ATTENTION_RULE,
      confidence: thin ? 0.4 : 0.75,
      rests_on: h.counted.length
        ? h.counted.map((a) => `articles/${a.id}`)
        : [
            isPart ? `section_parts/${partId}` : `sections/${sectionId}`,
            ...counted.slice(0, 1).map((a) => `articles/${a.id}`),
          ],
      evidence: { ...evidenceBase, balanced_share: Number(shareFor(id).toFixed(5)), in_final: isFinal },
    };
  };

  const rows: Row<"attention">[] = [
    ...sections.map((s) => row(s.id, s.id, null, s.in_final, false)),
    ...parts.map((p) => row(p.id, p.section_id, p.id, inFinal.get(p.section_id) ?? false, true)),
  ];

  const general = hitsFor((m) => m.whole || m.outside !== null);
  const outside: Record<string, number> = {};

  for (const a of general.counted) {
    const o = match(a).outside;

    if (o !== null && o !== "") {
      outside[o] = (outside[o] ?? 0) + 1;
    }
  }

  rows.push({
    id: `${bill}:general`,
    bill_id: bill,
    section_id: null,
    part_id: null,
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
        .toSorted((a, b) => b[1] - a[1])
        .map(([topic, n]) => ({ topic, articles: n })),
    },
  });

  const shareOf = (ids: Iterable<string>) => {
    const wanted = new Set(ids);

    return balanced(counted.filter((a) => wanted.has(a.id)));
  };

  return { rows, share, relevant: counted.length, counted, shareOf };
}
