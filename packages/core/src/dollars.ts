import type { Dollar } from "./bundle.ts";

type Baseline = Dollar["baseline"];

export interface FigureEstimate {
  id: string;
  publishedOn: string | null;
  perSection: boolean;
  baseline: Baseline;
  /** What CBO scored. Two baselines are read together only when they scored the same text. */
  versionScored?: string | null;
}

export interface FigureLine<C = string> {
  estimateId: string;
  measure: "budget_authority" | "outlays" | "revenues" | "deficit" | "nonscorable_revenues";
  /** $ millions, signed as CBO prints it. */
  amountMusd: number;
  split: "exact" | "even_split";
  claim: C;
}

/** A section's figure from one estimate: one baseline, one number. */
export interface BaselineFigure<C = string> {
  /** Deficit effect in $ millions: positive adds to the deficit, negative reduces it. */
  musd: number;
  baseline: Baseline;
  estimateId: string;
  /** deficit, else outlays minus revenues, else budget authority. */
  measure: "deficit" | "outlays - revenues" | "budget_authority";
  split: "exact" | "even_split";
  claims: C[];
  /** False when a later estimate exists but does not list the section (it was dropped before the final text). */
  fromLatest: boolean;
}

/**
 * The figure that counts for a section, and the same section against every other baseline CBO printed for that text.
 * A section that is big against only one baseline is big because of the baseline (an extension of a provision that
 * expires costs trillions against current law and nothing against current policy), so the smaller figure counts.
 */
export interface Figure<C = string> extends BaselineFigure<C> {
  byBaseline: BaselineFigure<C>[];
}

const newest = (a: FigureEstimate, b: FigureEstimate) =>
  (b.publishedOn ?? "").localeCompare(a.publishedOn ?? "") || b.id.localeCompare(a.id);

const BASELINE_ORDER: Baseline[] = ["current-law", "current-policy"];

/**
 * The estimates a section figure can come from: per baseline, its per-section estimates newest first, kept only when
 * the newest of the baseline scored the same text as the newest of all (a Senate-substitute pair does not mix with an
 * enacted-law estimate). Ordered by baseline, current law first.
 */
export function figureChains<E extends FigureEstimate>(estimates: E[]): E[][] {
  const chains = new Map<Baseline, E[]>();
  for (const e of estimates.filter((e) => e.perSection).sort(newest))
    chains.set(e.baseline, [...(chains.get(e.baseline) ?? []), e]);
  const latest = [...chains.values()].map((c) => c[0]!).sort(newest)[0];
  return BASELINE_ORDER.flatMap((b) => {
    const chain = chains.get(b);
    return chain && (chain[0]!.versionScored ?? null) === (latest?.versionScored ?? null) ? [chain] : [];
  });
}

/** The latest per-section estimates, one per baseline, that figures are read from. */
export const figureEstimates = <E extends FigureEstimate>(estimates: E[]): E[] =>
  figureChains(estimates).map((c) => c[0]!);

function fromChain<C>(lines: FigureLine<C>[], chain: FigureEstimate[]): BaselineFigure<C> | null {
  for (const [i, est] of chain.entries()) {
    const mine = lines.filter((l) => l.estimateId === est.id);
    const by = (m: FigureLine["measure"]) => mine.filter((l) => l.measure === m);
    const total = (xs: FigureLine<C>[]) => xs.reduce((a, l) => a + l.amountMusd, 0);
    const [used, musd, measure] = by("deficit").length
      ? ([by("deficit"), total(by("deficit")), "deficit"] as const)
      : by("outlays").length || by("revenues").length
        ? ([
            [...by("outlays"), ...by("revenues")],
            total(by("outlays")) - total(by("revenues")),
            "outlays - revenues",
          ] as const)
        : ([by("budget_authority"), total(by("budget_authority")), "budget_authority"] as const);
    if (!used.length) continue;
    return {
      musd,
      baseline: est.baseline,
      estimateId: est.id,
      measure,
      split: used.some((l) => l.split === "even_split") ? "even_split" : "exact",
      claims: used.map((l) => l.claim),
      fromLatest: i === 0,
    };
  }
  return null;
}

/**
 * A section's dollar figure: per baseline, the latest per-section estimate that lists the section; of those, the
 * figure with the smaller size counts. A figure that is only an even share of a group line counts only when no baseline
 * has an exact one. Dollars from different estimates of the same bill (House-passed, Senate draft, enacted) describe
 * different text and are never added together. `lines` are the section's CBO lines.
 */
export function sectionFigure<C>(lines: FigureLine<C>[], estimates: FigureEstimate[]): Figure<C> | null {
  const found = figureChains(estimates).flatMap((chain) => fromChain(lines, chain) ?? []);
  const current = found.filter((f) => f.fromLatest);
  const pool = current.length ? current : found;
  const exact = pool.filter((f) => f.split === "exact");
  const counted = [...(exact.length ? exact : pool)].sort((a, b) => Math.abs(a.musd) - Math.abs(b.musd))[0];
  return counted ? { ...counted, byBaseline: pool } : null;
}
