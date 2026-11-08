import type { Dollar } from "./bundle.ts";

type Baseline = Dollar["baseline"];

export interface FigureEstimate {
  id: string;
  publishedOn: string | null;
  perSection: boolean;
  baseline: Baseline;
  versionScored?: string | null;
}

export interface FigureLine<C = string> {
  estimateId: string;
  measure: "budget_authority" | "outlays" | "revenues" | "deficit" | "nonscorable_revenues";
  amountMusd: number;
  split: "exact" | "even_split";
  claim: C;
}

export interface BaselineFigure<C = string> {
  musd: number;
  baseline: Baseline;
  estimateId: string;
  measure: "deficit" | "outlays - revenues" | "budget_authority";
  split: "exact" | "even_split";
  claims: C[];
  fromLatest: boolean;
}

export interface Figure<C = string> extends BaselineFigure<C> {
  byBaseline: BaselineFigure<C>[];
}

const newest = (a: FigureEstimate, b: FigureEstimate) =>
  (b.publishedOn ?? "").localeCompare(a.publishedOn ?? "") || b.id.localeCompare(a.id);

const BASELINE_ORDER: Baseline[] = ["current-law", "current-policy"];

export function figureChains<E extends FigureEstimate>(estimates: E[]): E[][] {
  const chains = new Map<Baseline, E[]>();

  for (const est of estimates.filter((e) => e.perSection).toSorted(newest)) {
    chains.set(est.baseline, [...(chains.get(est.baseline) ?? []), est]);
  }

  const latest = [...chains.values()].flatMap(([first]) => first ?? []).toSorted(newest)[0];

  return BASELINE_ORDER.flatMap((b) => {
    const chain = chains.get(b);
    const head = chain?.[0];

    return chain !== undefined && head !== undefined && (head.versionScored ?? null) === (latest?.versionScored ?? null)
      ? [chain]
      : [];
  });
}

export const figureEstimates = <E extends FigureEstimate>(estimates: E[]): E[] =>
  figureChains(estimates).flatMap(([first]) => first ?? []);

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

    if (!used.length) {
      continue;
    }

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

export function sectionFigure<C>(lines: FigureLine<C>[], estimates: FigureEstimate[]): Figure<C> | null {
  const found = figureChains(estimates).flatMap((chain) => fromChain(lines, chain) ?? []);
  const current = found.filter((f) => f.fromLatest);
  const pool = current.length ? current : found;
  const exact = pool.filter((f) => f.split === "exact");
  const counted = (exact.length ? exact : pool).toSorted((a, b) => Math.abs(a.musd) - Math.abs(b.musd))[0];

  return counted ? { ...counted, byBaseline: pool } : null;
}
