import { money } from "./cards.ts";
import { R } from "./polar.ts";

export interface Decade {
  exp: number;
  musd: number;
  label: string;
  t: number;
}

export interface DollarScale {
  loExp: number;
  hiExp: number;
  decades: Decade[];
  /** Bar length in ring units for a deficit figure in $ millions; stubs (no figure) get the minimum. */
  length: (musd: number | null) => number;
  /** Ring radius where this decade's guide sits, measured from the bar base. */
  radius: (t: number) => number;
}

const MAX_DECADES = 5;

/**
 * Rings are decades of dollars, derived from the bill's own section figures: the biggest decade up to the next
 * power of ten, the smallest down to the one under the smallest figure but never more than five decades below
 * the top. Smaller figures sit on the baseline.
 */
export function dollarScale(figures: (number | null)[]): DollarScale | null {
  const abs = figures.filter((v): v is number => v != null && v !== 0).map(Math.abs);
  if (!abs.length) return null;
  const hiExp = Math.ceil(Math.log10(Math.max(...abs)) - 1e-9);
  let loExp = Math.max(Math.floor(Math.log10(Math.min(...abs)) + 1e-9), hiExp - MAX_DECADES);
  if (hiExp - loExp < 1) loExp = hiExp - 1;
  const span = hiExp - loExp;
  const decades: Decade[] = [];
  for (let exp = loExp; exp <= hiExp; exp++)
    decades.push({ exp, musd: 10 ** exp, label: money(10 ** exp * 1e6), t: (exp - loExp) / span });
  const t = (v: number) => (Math.log10(Math.max(Math.abs(v), 10 ** loExp)) - loExp) / span;
  return {
    loExp,
    hiExp,
    decades,
    length: (v) => R.barMin + (v == null || v === 0 ? 0 : t(v) * R.barSpan),
    radius: (tt) => R.bars + R.barMin + tt * R.barSpan,
  };
}
