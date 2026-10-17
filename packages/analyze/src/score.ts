import { type BillId, figureOrder, type Row, sectionFigure } from "@antibody/core";

/**
 * The buried score, one formula for every bill and party. Every constant is here and in SCORE_TEXT.
 */
export const SCORE = {
  version: "buried-v2",
  /** $1M → 0, $1B → 0.5, $1T → 1 (log scale). */
  dollarsFullAt: 1_000_000,
  /** 1 report → 0.15, 10 → 0.52, 100 → 1 (log scale). */
  reportsFullAt: 100,
  /** Largest late bonus; scaled down by the share of the bill that arrived late (a rewrite is not a sneak). */
  lateBonus: 0.25,
  offTopicBonus: 0.25,
  /** headline: top tenth by attention, with at least this many articles. */
  headlinePct: 0.9,
  headlineMinHits: 3,
  /** costly: stakes of at least this much, which is $10B in CBO's figure for the section itself, or 21 lobbying reports. */
  costlyMin: 2 / 3,
  /** quiet: fewer than this share of the bill's relevant articles (each side weighted equally) discussed the section. */
  quietShare: 0.01,
  /** A shorter bill has nothing for a section to be buried among. */
  minSections: 10,
} as const;

export const SCORE_TEXT = [
  "Stakes: how much the section matters, from 0 to 1. It is the larger of two numbers. Dollars: CBO's 10-year estimate for the section on a log scale, where $1 million is 0, $1 billion is 0.5 and $1 trillion is 1 (cuts and costs count the same; a dollar figure that is only an even share of a line CBO printed for several sections is shown but not counted). Lobbying: the number of lobbying reports that name the section, on a log scale where 1 report is 0.15, 10 is 0.52 and 100 is 1.",
  "Quiet: from 1 (no sampled article discussed the section) down to 0 (1 in 100 articles or more did). It is based on the share of the bill's relevant news articles that discuss the section, with the left, center and right press weighted equally. A section is quiet when under 1 in 100 articles discussed it, which is none or about one in a typical sample of 250 to 350 articles.",
  "Late or off-topic (called 'sneak' in the code): 1, plus up to 0.25 if the section first appeared after a chamber had already passed the bill (from the bill's version history), plus 0.25 times how unlike the rest of the bill it is (0 to 1). The late bonus is multiplied by one minus the share of the bill that arrived late, so it shrinks smoothly as more of the bill is late (there is no cutoff): when a bill is rewritten late, being late says less about any one section. Off-topic distance counts only in a bill with a single committee title: a bill assembled from several committees' titles has a minority title by construction.",
  "Buried score = stakes × quiet × (late or off-topic), from 0 to 1.5. It ranks the buried sections of a bill; it does not decide the label.",
  "Label: 'headline' when a section is in the top tenth of its bill by attention and at least 3 articles discussed it. 'Buried' (shown on the site as 'quiet and costly') when stakes are at least two thirds (CBO's figure for the section itself is $10 billion or more, or 21 or more lobbying reports name it) and the section is quiet, in a bill of at least 10 sections. Everything else is 'normal'.",
  "Being late or off-topic is shown and ranks a section higher, but a costly, quiet section is buried without it. The rule is not symmetric on purpose, and the page says so: a section with no CBO figure can still qualify through lobbying alone, and a big dollar figure with a loud news cycle is never labeled buried, whatever it does. A bill with no section-level dollars and no section named by lobbyists, a bill whose news cannot be ranked, and a bill of fewer than 10 sections cannot be tested: the page says which.",
  "All parts are shown next to the label. The formula never looks at party, sponsor or outlet lean; the thresholds are the same for every bill.",
];

export const SCORE_RULE = `${SCORE.version}: ${SCORE_TEXT.join(" ")}`;

const log01 = (x: number, full: number) => Math.min(1, Math.max(0, Math.log10(1 + Math.abs(x)) / Math.log10(1 + full)));

export interface Components {
  /** Dollars from an even split of a grouped CBO line are shown but do not count toward stakes: CBO never gave that section a number. */
  dollarsSplit?: "exact" | "even_split" | null;
  /** Share of the bill's final sections that arrived late; scales the late bonus. */
  lateShare?: number;
  /** Distinct committee titles or divisions among the final sections; off-topic distance only counts in a bill with one. */
  titles?: number;
  /** Final sections in the bill; a bill shorter than `SCORE.minSections` has nothing to bury a section in. */
  sections?: number;
  dollarsMusd: number | null;
  attentionPct: number | null;
  /** Share of the bill's relevant articles that discuss the section, each side weighted equally (null when the bill's sections are not ranked). */
  attentionShare?: number | null;
  late: boolean;
  offTopic: number | null;
  lobbyingReports: number;
}

export function stakes(c: Pick<Components, "dollarsMusd" | "dollarsSplit" | "lobbyingReports">): number {
  return Math.max(
    c.dollarsMusd === null || c.dollarsSplit === "even_split" ? 0 : log01(c.dollarsMusd, SCORE.dollarsFullAt),
    log01(c.lobbyingReports, SCORE.reportsFullAt),
  );
}

/** 1 when no sampled article discussed the section, 0 at `SCORE.quietShare` or more; null when attention is unranked. */
export function quiet(c: Pick<Components, "attentionPct" | "attentionShare">): number | null {
  if (c.attentionPct === null || c.attentionShare == null) return null;
  return 1 - Math.min(1, c.attentionShare / SCORE.quietShare);
}

const lateCounts = (c: Pick<Components, "late" | "lateShare">) => c.late && (c.lateShare ?? 0) < 1;
const offTopicOf = (c: Pick<Components, "offTopic" | "titles">) => ((c.titles ?? 1) > 1 ? 0 : (c.offTopic ?? 0));

export function buried(c: Components): number | null {
  const q = quiet(c);
  if (q === null) return null;
  const sneak =
    1 + (lateCounts(c) ? SCORE.lateBonus * (1 - (c.lateShare ?? 0)) : 0) + SCORE.offTopicBonus * offTopicOf(c);
  return Number((stakes(c) * q * sneak).toFixed(4));
}

export function label(c: Components, hits: number): Row<"section_scores">["label"] {
  if (c.attentionPct !== null && c.attentionPct >= SCORE.headlinePct && hits >= SCORE.headlineMinHits)
    return "headline";
  const long = (c.sections ?? SCORE.minSections) >= SCORE.minSections;
  if (long && stakes(c) >= SCORE.costlyMin && (quiet(c) ?? 0) > 0) return "buried";
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
 * Dollars per section from one CBO estimate: the latest current-law estimate with per-section lines (see
 * `sectionFigure` in core, which the site uses too). Signed as a deficit effect (positive adds to the deficit). Group
 * lines are left out: their even shares are already section lines that rest on them.
 */
export function sectionDollars(estimates: Row<"cbo_estimates">[], lines: Row<"cbo_lines">[]) {
  const out = new Map<string, SectionDollars>();
  const known = estimates.map((e) => ({
    id: e.id,
    publishedOn: e.published_on,
    perSection: e.per_section,
    baseline: e.baseline,
  }));
  const est = figureOrder(known)[0];
  const bySection = new Map<string, Row<"cbo_lines">[]>();
  for (const l of lines)
    if (l.line_kind === "section")
      for (const sid of l.section_ids) bySection.set(sid, [...(bySection.get(sid) ?? []), l]);
  for (const [sid, ls] of bySection) {
    const f = sectionFigure(
      ls.map((l) => ({
        estimateId: l.estimate_id,
        measure: l.measure,
        amountMusd: l.total_musd,
        split: l.split,
        claim: l.id,
      })),
      known,
    );
    if (f?.fromLatest)
      out.set(sid, { musd: f.musd, split: f.split, lineIds: f.claims, measure: f.measure, estimateId: f.estimateId });
  }
  return { estimate: est ? (estimates.find((e) => e.id === est.id) ?? null) : null, bySection: out };
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
  const final = sections.filter((s) => s.in_final);
  const lateShare = final.length ? final.filter((s) => s.late).length / final.length : 0;
  const titles = new Set(final.map((s) => s.path.split("/")[0]).filter((p) => /^(title|division):/.test(p!))).size;
  return final.map((s) => {
    const a = att.get(s.id);
    const share = a && a.pct !== null ? Number((a.evidence as { balanced_share: number }).balanced_share) : null;
    const d = dollars.bySection.get(s.id) ?? null;
    const { filings, refs } = reports.get(s.id) ?? { filings: [], refs: [] };
    const c: Components = {
      dollarsMusd: d ? Number(d.musd.toFixed(1)) : null,
      dollarsSplit: d?.split ?? null,
      attentionPct: a?.pct ?? null,
      attentionShare: share,
      sections: final.length,
      late: s.late,
      lateShare,
      titles,
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
      attention_share: share,
      late: c.late,
      off_topic: c.offTopic,
      lobbying_reports: c.lobbyingReports,
      rule: SCORE_RULE,
      confidence: d?.split === "even_split" ? 0.5 : 0.7,
      rests_on: restsOn,
      evidence: {
        version: SCORE.version,
        late_share: Number(lateShare.toFixed(4)),
        titles,
        stakes: Number(stakes(c).toFixed(4)),
        quiet: quiet(c) === null ? null : Number(quiet(c)!.toFixed(4)),
        dollars_measure: d?.measure ?? null,
        cbo_estimate: d?.estimateId ?? null,
        lobbying_filings: filings,
        attention_hits: a?.hits ?? 0,
      },
    };
  });
}
