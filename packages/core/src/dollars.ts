import type { Dollar } from "./bundle.ts";

export interface FigureEstimate {
  id: string;
  publishedOn: string | null;
  perSection: boolean;
  baseline: Dollar["baseline"];
}

export interface FigureLine<C = string> {
  estimateId: string;
  measure: "budget_authority" | "outlays" | "revenues" | "deficit" | "nonscorable_revenues";
  /** $ millions, signed as CBO prints it. */
  amountMusd: number;
  split: "exact" | "even_split";
  claim: C;
}

/** One number per section, from one estimate, and which estimate that was. */
export interface Figure<C = string> {
  /** Deficit effect in $ millions: positive adds to the deficit, negative reduces it. */
  musd: number;
  estimateId: string;
  /** deficit, else outlays minus revenues, else budget authority. */
  measure: "deficit" | "outlays - revenues" | "budget_authority";
  split: "exact" | "even_split";
  claims: C[];
  /** False when a later estimate exists but does not list the section (it was dropped before the final text). */
  fromLatest: boolean;
}

/** The estimates a section figure can come from, latest first: per-section, current-law, newest publication date. */
export function figureOrder<E extends FigureEstimate>(estimates: E[]): E[] {
  return estimates
    .filter((e) => e.perSection && e.baseline === "current-law")
    .sort((a, b) => (b.publishedOn ?? "").localeCompare(a.publishedOn ?? "") || b.id.localeCompare(a.id));
}

/**
 * A section's dollar figure from a single estimate: the latest per-section current-law estimate that lists the
 * section. Dollars from different estimates of the same bill (House-passed, Senate draft, enacted) describe different
 * text and are never added together. `lines` are the section's CBO lines.
 */
export function sectionFigure<C>(lines: FigureLine<C>[], estimates: FigureEstimate[]): Figure<C> | null {
  const order = figureOrder(estimates);
  for (const [i, est] of order.entries()) {
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
      estimateId: est.id,
      measure,
      split: used.some((l) => l.split === "even_split") ? "even_split" : "exact",
      claims: used.map((l) => l.claim),
      fromLatest: i === 0,
    };
  }
  return null;
}
