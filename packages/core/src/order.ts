const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100 } as const;
const KIND_RANK: Record<string, number> = {
  sec: 0,
  division: 1,
  title: 2,
  subtitle: 3,
  chapter: 4,
  subchapter: 5,
  part: 6,
};

const roman = (s: string) =>
  [...s].reduce((n, c, i) => {
    const v = ROMAN[c as keyof typeof ROMAN];
    return n + (v < (ROMAN[s[i + 1] as keyof typeof ROMAN] ?? 0) ? -v : v);
  }, 0);

function compareValue(kind: string, a: string, b: string): number {
  const numeral = kind !== "division" && kind !== "subtitle" && /^[IVXLC]+$/.test(a) && /^[IVXLC]+$/.test(b);
  if (numeral) return roman(a) - roman(b);
  if (/^[A-Z]+$/.test(a) && /^[A-Z]+$/.test(b)) return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
  return a.localeCompare(b, "en", { numeric: true });
}

/**
 * Where two sections sit in the law's text, from their paths (`division:A/title:VII/subtitle:B/sec:70322`): divisions
 * run A..Z then AA, titles and parts are Roman numerals, subtitles letters, everything else numbers. A bare section sits before the containers
 * beside it, which is where a short title and definitions go. A section's number alone can't order a bill: omnibus
 * bills reuse the same numbers in every division.
 */
export function compareBillPath(a: string, b: string): number {
  const pa = a.split("/");
  const pb = b.split("/");
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const [ka = "", va = ""] = pa[i]!.split(":");
    const [kb = "", vb = ""] = pb[i]!.split(":");
    if (ka !== kb) return (KIND_RANK[ka] ?? 7) - (KIND_RANK[kb] ?? 7) || ka.localeCompare(kb);
    const c = compareValue(ka, va, vb);
    if (c) return c;
  }
  return pa.length - pb.length;
}

/** A copy of `sections` in the order of the law's text. */
export const inBillOrder = <T extends { path: string }>(sections: T[]): T[] =>
  [...sections].sort((x, y) => compareBillPath(x.path, y.path));
