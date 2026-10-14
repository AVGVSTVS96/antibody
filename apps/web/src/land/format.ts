import type { Stats } from "./rules.ts";

/** $ millions as three significant digits, the way the boards print it: $3.39T, $58.1B, $120M. */
export function money(musd: number): string {
  const a = Math.abs(musd);
  const [n, unit] = a >= 1e6 ? [a / 1e6, "T"] : a >= 1e3 ? [a / 1e3, "B"] : [a, "M"];
  return `$${Number(n.toPrecision(3))}${unit}`;
}

export const signed = (musd: number) => `${musd < 0 ? "−" : "+"}${money(musd)}`;

/** What a bill's CBO deficit total does, in words, so a sign never has to carry it alone. */
export function deficitVerb(musd: number): string {
  return musd < 0 ? "cuts the deficit" : "adds to the deficit";
}

export interface DeficitCell {
  value: string | null;
  note: string;
}

/** The library's CBO column: the signed total with what it does in words, or "no CBO total". */
export function deficitCell(s: Stats): DeficitCell {
  if (s.deficitMusd == null) return { value: null, note: "no CBO total" };
  const verb = s.deficitMusd < 0 ? "cuts" : "adds";
  return { value: signed(s.deficitMusd), note: s.deficitDirectOnly ? `${verb} · direct only` : `${verb} deficit` };
}
