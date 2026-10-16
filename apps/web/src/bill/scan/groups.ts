import type { BillModel, SectionView } from "../../lib/model.ts";

export interface SectionGroup {
  id: string;
  key: string;
  label: string;
  sections: SectionView[];
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

function roman(s: string): number | null {
  if (!/^[IVXLCDM]+$/.test(s)) return null;
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]!]!;
    total += v < (ROMAN[s[i + 1] ?? ""] ?? 0) ? -v : v;
  }
  return total;
}

const top = /^(title|division):(.+)$/;

/** A bill's own divisions run A to Z then AA, BB; titles run by numeral. Anything else keeps the order it arrived in. */
function order(a: string, b: string): number {
  const [, ka, va = ""] = a.match(top) ?? [];
  const [, kb, vb = ""] = b.match(top) ?? [];
  if (ka !== kb) return (ka === "division" ? 0 : 1) - (kb === "division" ? 0 : 1);
  const ra = roman(va);
  const rb = roman(vb);
  if (ka === "title" && ra != null && rb != null) return ra - rb;
  return va.length - vb.length || va.localeCompare(vb);
}

const labelOf = (key: string, only: boolean) => {
  const hit = key.match(top);
  if (!hit) return only ? "The bill" : "General sections";
  return `${hit[1] === "title" ? "Title" : "Division"} ${hit[2]}`;
};

/**
 * The final sections grouped by the title or division of the bill they sit in (the bundle carries no committee for
 * a section). Sections with no title or division of their own form one group. Bill order is kept inside a group.
 */
export function groupSections(m: BillModel): SectionGroup[] {
  const by = new Map<string, SectionView[]>();
  for (const v of m.sections) {
    if (!v.s.inFinal) continue;
    const key = top.test(v.s.path.split("/")[0]!) ? v.s.path.split("/")[0]! : "";
    const list = by.get(key);
    if (list) list.push(v);
    else by.set(key, [v]);
  }
  const keys = [...by.keys()].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : order(a, b)));
  return keys.map((key) => ({
    id: `group:${key || "general"}`,
    key,
    label: labelOf(key, keys.length === 1),
    sections: by.get(key)!,
  }));
}
