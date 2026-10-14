import type { BillId, Row } from "@antibody/core";

/**
 * The buried score, one formula for every bill and party. Every constant is here and in SCORE_TEXT.
 */
export const SCORE = {
  version: "buried-v1",
  /** $1M → 0, $1B → 0.5, $1T → 1 (log scale). */
  dollarsFullAt: 1_000_000,
  /** 1 report → 0.15, 10 → 0.52, 100 → 1 (log scale). */
  reportsFullAt: 100,
  lateBonus: 0.25,
  offTopicBonus: 0.25,
  /** headline: top tenth by attention, with at least this many articles. */
  headlinePct: 0.9,
  headlineMinHits: 3,
  /** buried: score at least this high, and stakes of at least $1B or about 9 lobbying reports. */
  buriedMin: 0.45,
  buriedMinStakes: 0.5,
} as const;

export const SCORE_TEXT = [
  "Stakes: how much the section matters, from 0 to 1. It is the larger of two numbers. Dollars: CBO's 10-year estimate for the section on a log scale, where $1 million is 0, $1 billion is 0.5 and $1 trillion is 1 (cuts and costs count the same). Lobbying: the number of lobbying reports that name the section, on a log scale where 1 report is 0.15, 10 is 0.52 and 100 is 1.",
  "Quiet: 1 minus the section's attention percentile within its bill, so the least-covered section is close to 1 and the most-covered is 0.",
  "Sneak: 1, plus 0.25 if the section first appeared after a chamber had already passed the bill (from the bill's version history), plus 0.25 times how unlike the rest of the bill it is (0 to 1).",
  "Buried score = stakes × quiet × sneak, from 0 to 1.5.",
  "Label: 'headline' when a section is in the top tenth of its bill by attention and at least 3 articles discussed it. 'Buried' when the score is at least 0.45 and stakes are at least 0.5 ($1 billion, or about 9 lobbying reports). Everything else is 'normal'.",
  "All three parts are shown next to the label. The formula never looks at party, sponsor or outlet lean; the thresholds are the same for every bill.",
];

export const SCORE_RULE = `${SCORE.version}: ${SCORE_TEXT.join(" ")}`;

const log01 = (x: number, full: number) => Math.min(1, Math.max(0, Math.log10(1 + Math.abs(x)) / Math.log10(1 + full)));

export interface Components {
  dollarsMusd: number | null;
  attentionPct: number | null;
  late: boolean;
  offTopic: number | null;
  lobbyingReports: number;
}

export function stakes(c: Pick<Components, "dollarsMusd" | "lobbyingReports">): number {
  return Math.max(
    c.dollarsMusd === null ? 0 : log01(c.dollarsMusd, SCORE.dollarsFullAt),
    log01(c.lobbyingReports, SCORE.reportsFullAt),
  );
}

export function buried(c: Components): number | null {
  if (c.attentionPct === null) return null;
  const quiet = 1 - c.attentionPct;
  const sneak = 1 + (c.late ? SCORE.lateBonus : 0) + SCORE.offTopicBonus * (c.offTopic ?? 0);
  return Number((stakes(c) * quiet * sneak).toFixed(4));
}

export function label(c: Components, hits: number): Row<"section_scores">["label"] {
  if (c.attentionPct !== null && c.attentionPct >= SCORE.headlinePct && hits >= SCORE.headlineMinHits)
    return "headline";
  const b = buried(c);
  if (b !== null && b >= SCORE.buriedMin && stakes(c) >= SCORE.buriedMinStakes) return "buried";
  return "normal";
}

export interface SectionDollars {
  musd: number;
  split: "exact" | "even_split";
  lineIds: string[];
  measure: string;
  estimateId: string;
}

/**
 * Dollars per section from one CBO estimate: the latest current-law estimate with per-section lines. Signed as a
 * deficit effect (positive adds to the deficit): CBO's deficit line when there is one, else outlays minus revenues,
 * else budget authority.
 */
export function sectionDollars(estimates: Row<"cbo_estimates">[], lines: Row<"cbo_lines">[]) {
  const out = new Map<string, SectionDollars>();
  const est = estimates
    .filter((e) => e.per_section && e.baseline === "current-law")
    .sort((a, b) => (b.published_on ?? "").localeCompare(a.published_on ?? ""))[0];
  if (!est) return { estimate: null, bySection: out };
  const bySection = new Map<string, Row<"cbo_lines">[]>();
  for (const l of lines)
    if (l.estimate_id === est.id && l.line_kind !== "whole-bill")
      for (const sid of l.section_ids) bySection.set(sid, [...(bySection.get(sid) ?? []), l]);
  for (const [sid, ls] of bySection) {
    const sum = (m: string) => ls.filter((l) => l.measure === m);
    const total = (xs: Row<"cbo_lines">[]) => xs.reduce((a, l) => a + l.total_musd, 0);
    const deficit = sum("deficit");
    const outlays = sum("outlays");
    const revenues = sum("revenues");
    const ba = sum("budget_authority");
    const [used, musd, measure] = deficit.length
      ? [deficit, total(deficit), "deficit"]
      : outlays.length || revenues.length
        ? [[...outlays, ...revenues], total(outlays) - total(revenues), "outlays - revenues"]
        : [ba, total(ba), "budget_authority"];
    if (!used.length) continue;
    out.set(sid, {
      musd,
      split: used.some((l) => l.split === "even_split") ? "even_split" : "exact",
      lineIds: used.map((l) => l.id),
      measure,
      estimateId: est.id,
    });
  }
  return { estimate: est, bySection: out };
}

/** Lobbying reports (distinct filings) whose bill reference names the section's number. */
export function sectionReports(sections: Row<"sections">[], refs: Row<"lda_bill_refs">[]) {
  const byNum = new Map<string, Row<"lda_bill_refs">[]>();
  for (const r of refs) for (const n of r.section_nums) byNum.set(n, [...(byNum.get(n) ?? []), r]);
  return new Map(
    sections.map((s) => {
      const rs = byNum.get(s.num) ?? [];
      return [s.id, { filings: [...new Set(rs.map((r) => r.filing_id))], refs: rs.map((r) => r.id) }];
    }),
  );
}
export type Reports = ReturnType<typeof sectionReports>;

/** Boilerplate sections get no off-topic value: a short title is always unlike the rest of a bill. */
export const BOILERPLATE =
  /^(short title|table of contents|definitions?|effective dates?|severability|rules? of construction|references?|(clerical|conforming|technical)( and (clerical|conforming|technical))* amendments?|authorization of appropriations|sense of (congress|the senate|the house))\b/i;

export function scoreRows(
  bill: BillId,
  sections: Row<"sections">[],
  attention: Row<"attention">[],
  dollars: ReturnType<typeof sectionDollars>,
  reports: Reports,
  offTopic: Map<string, number>,
): Row<"section_scores">[] {
  const att = new Map(attention.filter((a) => a.section_id).map((a) => [a.section_id!, a]));
  return sections
    .filter((s) => s.in_final)
    .map((s) => {
      const a = att.get(s.id);
      const d = dollars.bySection.get(s.id) ?? null;
      const { filings, refs } = reports.get(s.id) ?? { filings: [], refs: [] };
      const c: Components = {
        dollarsMusd: d ? Number(d.musd.toFixed(1)) : null,
        attentionPct: a?.pct ?? null,
        late: s.late,
        offTopic: offTopic.get(s.id) ?? null,
        lobbyingReports: filings.length,
      };
      const restsOn = [
        `sections/${s.id}`,
        ...(a ? [`attention/${a.id}`] : []),
        ...(d?.lineIds.map((id) => `cbo_lines/${id}`) ?? []),
        ...refs.map((id) => `lda_bill_refs/${id}`),
      ];
      return {
        id: `${bill}:${s.id}`,
        bill_id: bill,
        section_id: s.id,
        label: label(c, a?.hits ?? 0),
        buried: buried(c),
        dollars_musd: c.dollarsMusd,
        dollars_split: d?.split ?? null,
        attention_pct: c.attentionPct,
        late: c.late,
        off_topic: c.offTopic,
        lobbying_reports: c.lobbyingReports,
        rule: SCORE_RULE,
        confidence: d?.split === "even_split" ? 0.5 : 0.7,
        rests_on: restsOn,
        evidence: {
          version: SCORE.version,
          stakes: Number(stakes(c).toFixed(4)),
          quiet: c.attentionPct === null ? null : Number((1 - c.attentionPct).toFixed(4)),
          dollars_measure: d?.measure ?? null,
          cbo_estimate: d?.estimateId ?? null,
          lobbying_filings: filings,
          attention_hits: a?.hits ?? 0,
        },
      };
    });
}
