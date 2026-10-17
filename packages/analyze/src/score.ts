import { type BillId, figureEstimates, type Row, sectionFigure } from "@antibody/core";

/**
 * The buried score, one formula for every bill and party. Every constant is here and in SCORE_TEXT.
 */
export const SCORE = {
  version: "buried-v3",
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
  /** costly: stakes of at least this much, which is $10B in CBO's figure for the section itself (the smaller one when CBO printed it against two baselines), or 21 lobbying reports. */
  costlyMin: 2 / 3,
  /** quiet: fewer than this share of the bill's relevant articles (each side weighted equally) discussed the section. */
  quietShare: 0.01,
  /** A shorter bill has nothing for a section to be buried among. */
  minSections: 10,
} as const;

export const SCORE_TEXT = [
  "Stakes: how much the section matters, from 0 to 1. It is the larger of two numbers. Dollars: CBO's 10-year estimate for the section on a log scale, where $1 million is 0, $1 billion is 0.5 and $1 trillion is 1 (cuts and costs count the same; a dollar figure that is only an even share of a line CBO printed for several sections is shown but not counted). When CBO printed the section against two baselines for the same text, current law and the Senate's current-policy baseline (which treats the expiring 2017 tax cuts as continuing), the smaller figure counts, because a section that is big against only one of them is big because of the baseline, not because of what the section does. Both are shown. Where CBO printed only current law, a section that extends a provision set to expire keeps its full current-law figure, which is the cost of continuing it. Lobbying: the number of lobbying reports that name the section, on a log scale where 1 report is 0.15, 10 is 0.52 and 100 is 1.",
  "Quiet: from 1 (no sampled article discussed the section) down to 0 (1 in 100 articles or more did). It is based on the share of the bill's relevant news articles that discuss the section, with the left, center and right press weighted equally. A section is quiet when under 1 in 100 articles discussed it, which is none or about one in a typical sample of 250 to 350 articles.",
  "Late or off-topic (called 'sneak' in the code): 1, plus up to 0.25 if the section first appeared after a chamber had already passed the bill (from the bill's version history), plus 0.25 times how unlike the rest of the bill it is (0 to 1). The late bonus is multiplied by one minus the share of the bill that arrived late, so it shrinks smoothly as more of the bill is late (there is no cutoff): when a bill is rewritten late, being late says less about any one section. Off-topic distance counts only in a bill with a single committee title: a bill assembled from several committees' titles has a minority title by construction.",
  "Buried score = stakes × quiet × (late or off-topic), from 0 to 1.5. It ranks the buried sections of a bill; it does not decide the label.",
  "Label: 'headline' when a section is in the top tenth of its bill by attention and at least 3 articles discussed it; a section that only gives the bill its name (a short title or table of contents) is never a headline, because an article that names the bill is not discussing a provision. 'Buried' (shown on the site as 'quiet and costly') when stakes are at least two thirds (CBO's figure for the section itself is $10 billion or more against every baseline CBO printed it against, or 21 or more lobbying reports name it) and the section is quiet, in a bill of at least 10 sections; a pay-for (a section that cuts, to the million dollars, exactly what another section in the same title spends, by CBO's figures) is shown with the section it pays for and is not labeled on its own, since the pair is one trade. Everything else is 'normal'.",
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
  /** The section only names the bill (a short title); articles that name the bill do not make it a headline. */
  namesBill?: boolean;
  /** The section this one pays for: it cuts what the other spends, to the dollar, so it is not a finding of its own. */
  offsets?: string | null;
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

export const NAMES_BILL = /^(short title|table of contents)\b/i;

export function label(c: Components, hits: number): Row<"section_scores">["label"] {
  if (!c.namesBill && c.attentionPct !== null && c.attentionPct >= SCORE.headlinePct && hits >= SCORE.headlineMinHits)
    return "headline";
  const long = (c.sections ?? SCORE.minSections) >= SCORE.minSections;
  if (long && !c.offsets && stakes(c) >= SCORE.costlyMin && (quiet(c) ?? 0) > 0) return "buried";
  return "normal";
}

export interface SectionDollars {
  /** The figure that counts: the smaller one when CBO printed the section against two baselines. */
  musd: number;
  split: "exact" | "even_split";
  baseline: Row<"cbo_estimates">["baseline"];
  /** Lines of every figure considered, not only the one that counts. */
  lineIds: string[];
  measure: string;
  estimateId: string;
  byBaseline: {
    baseline: Row<"cbo_estimates">["baseline"];
    musd: number;
    split: "exact" | "even_split";
    estimateId: string;
  }[];
}

/**
 * Dollars per section from CBO's latest per-section estimates (see `sectionFigure` in core, which the site uses too):
 * one per baseline CBO printed for the same text, the smaller figure counting. Signed as a deficit effect (positive
 * adds to the deficit). Group lines are left out: their even shares are already section lines that rest on them.
 */
export function sectionDollars(estimates: Row<"cbo_estimates">[], lines: Row<"cbo_lines">[]) {
  const out = new Map<string, SectionDollars>();
  const known = estimates.map((e) => ({
    id: e.id,
    publishedOn: e.published_on,
    perSection: e.per_section,
    baseline: e.baseline,
    versionScored: e.version_scored,
  }));
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
      out.set(sid, {
        musd: f.musd,
        split: f.split,
        baseline: f.baseline,
        lineIds: f.byBaseline.flatMap((b) => b.claims),
        measure: f.measure,
        estimateId: f.estimateId,
        byBaseline: f.byBaseline.map((b) => ({
          baseline: b.baseline,
          musd: Number(b.musd.toFixed(1)),
          split: b.split,
          estimateId: b.estimateId,
        })),
      });
  }
  const used = new Set(figureEstimates(known).map((e) => e.id));
  return { estimates: estimates.filter((e) => used.has(e.id)), bySection: out };
}

/**
 * Pay-fors: a section whose exact CBO figure is the opposite, to the million dollars, of another section's figure in the
 * same title or division, and that cuts what the other spends. Only figures big enough to be costly are paired.
 */
export function payFors(sections: Row<"sections">[], dollars: ReturnType<typeof sectionDollars>) {
  const parent = (s: Row<"sections">) => s.path.split("/").slice(0, -1).join("/");
  const big = sections.flatMap((s) => {
    const d = dollars.bySection.get(s.id);
    return d && d.split === "exact" && stakes({ dollarsMusd: d.musd, lobbyingReports: 0 }) >= SCORE.costlyMin
      ? [{ s, musd: Math.round(d.musd) }]
      : [];
  });
  const spends = new Map(big.filter((b) => b.musd > 0).map((b) => [`${parent(b.s)}|${b.musd}`, b.s.id]));
  return new Map(
    big.flatMap((b) => {
      const partner = b.musd < 0 ? spends.get(`${parent(b.s)}|${-b.musd}`) : undefined;
      return partner ? [[b.s.id, partner] as const] : [];
    }),
  );
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
  checks: Row<"attention_checks">[] = [],
): Row<"section_scores">[] {
  const att = new Map(attention.filter((a) => a.section_id).map((a) => [a.section_id!, a]));
  const checked = new Map(checks.map((c) => [c.section_id, c]));
  const final = sections.filter((s) => s.in_final);
  const lateShare = final.length ? final.filter((s) => s.late).length / final.length : 0;
  const pays = payFors(final, dollars);
  const titles = new Set(final.map((s) => s.path.split("/")[0]).filter((p) => /^(title|division):/.test(p!))).size;
  return final.map((s) => {
    const a = att.get(s.id);
    const check = checked.get(s.id);
    const share =
      check?.share ?? (a && a.pct !== null ? Number((a.evidence as { balanced_share: number }).balanced_share) : null);
    const d = dollars.bySection.get(s.id) ?? null;
    const { filings, refs } = reports.get(s.id) ?? { filings: [], refs: [] };
    const c: Components = {
      namesBill: NAMES_BILL.test(s.heading.trim()),
      offsets: pays.get(s.id) ?? null,
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
      ...(c.offsets ? (dollars.bySection.get(c.offsets)?.lineIds.map((id) => `cbo_lines/${id}`) ?? []) : []),
      ...refs.map((id) => `lda_bill_refs/${id}`),
      ...(check ? [`attention_checks/${check.id}`] : []),
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
      attention_checked: check ? check.article_ids.length : null,
      late: c.late,
      off_topic: c.offTopic,
      lobbying_reports: c.lobbyingReports,
      offsets_section_id: c.offsets ?? null,
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
        dollars_baseline: d?.baseline ?? null,
        dollars_by_baseline: d?.byBaseline ?? [],
        cbo_estimate: d?.estimateId ?? null,
        lobbying_filings: filings,
        attention_hits: (a?.hits ?? 0) + (check?.article_ids.length ?? 0),
      },
    };
  });
}
