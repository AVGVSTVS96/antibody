import type { BillModel, SectionView } from "../../lib/model.ts";

export interface SectionGroup {
  id: string;
  key: string;
  label: string;
  sections: SectionView[];
}

const ROMAN = new Map([
  ["I", 1],
  ["V", 5],
  ["X", 10],
  ["L", 50],
  ["C", 100],
  ["D", 500],
  ["M", 1000],
]);

function roman(s: string): number | null {
  if (!/^[IVXLCDM]+$/u.test(s)) {
    return null;
  }

  const values = s.split("").map((c) => ROMAN.get(c) ?? 0);

  return values.reduce((total, v, i) => total + (v < (values[i + 1] ?? 0) ? -v : v), 0);
}

const top = /^(title|division):(.+)$/u;

function order(a: string, b: string): number {
  const [, ka, va = ""] = top.exec(a) ?? [];
  const [, kb, vb = ""] = top.exec(b) ?? [];

  if (ka !== kb) {
    return (ka === "division" ? 0 : 1) - (kb === "division" ? 0 : 1);
  }

  const ra = roman(va);
  const rb = roman(vb);

  if (ka === "title" && ra !== null && rb !== null) {
    return ra - rb;
  }

  return va.length - vb.length || va.localeCompare(vb);
}

const labelOf = (key: string, only: boolean) => {
  const hit = top.exec(key);

  if (!hit) {
    return only ? "The bill" : "General sections";
  }

  return `${hit[1] === "title" ? "Title" : "Division"} ${hit[2]}`;
};

export function groupSections(m: Pick<BillModel, "sections">): SectionGroup[] {
  const by = new Map<string, SectionView[]>();

  for (const v of m.sections) {
    if (!v.s.inFinal) {
      continue;
    }

    const head = v.s.path.split("/")[0] ?? "";
    const key = top.test(head) ? head : "";
    const list = by.get(key);

    if (list) {
      list.push(v);
    } else {
      by.set(key, [v]);
    }
  }

  const groups = [...by].toSorted(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : order(a, b)));

  return groups.map(([key, sections]) => ({
    id: `group:${key || "general"}`,
    key,
    label: labelOf(key, groups.length === 1),
    sections,
  }));
}
