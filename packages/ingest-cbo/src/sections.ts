import type { Row } from "@antibody/core";

/**
 * CBO section numbers are the bill's own numbers in the version CBO scored ("Sec. 70101" = `sec:70101` in the
 * enrolled text). Numbers change between versions, so the join goes through that version's path in each
 * section lineage, never the number alone.
 */
export function sectionMap(sections: Row<"sections">[], code: string | null): (num: string) => string | undefined {
  const byVersion = numberings(sections);
  let m = (code && byVersion(code)) || new Map<string, string>();
  if (!m.size && code === "enr") m = byVersion("plaw");
  return (num) => m.get(num);
}

/**
 * CBO sometimes scores text GovInfo never published (a committee print, a Senate amendment). The version whose
 * numbering contains nearly all of CBO's section numbers is then the closest published text; the match is
 * reported so the line's citation can say the join rests on numbering alone.
 */
export function closestVersion(
  sections: Row<"sections">[],
  nums: string[],
  codes: string[],
): { code: string; covered: number } | null {
  const byVersion = numberings(sections);
  const unique = [...new Set(nums)];
  if (unique.length < 5) return null;
  const best = codes
    .map((code) => {
      const m = byVersion(code);
      return { code, covered: unique.filter((n) => m.has(n)).length };
    })
    .sort((a, b) => b.covered - a.covered)[0];
  return best && best.covered / unique.length >= 0.95 ? best : null;
}

function numberings(sections: Row<"sections">[]) {
  return (v: string) => {
    const m = new Map<string, string>();
    for (const s of sections) {
      const path = (s.history[v] as { path?: string } | undefined)?.path;
      const num = path?.split("/").at(-1)?.replace(/^sec:/, "");
      if (num && !m.has(num)) m.set(num, s.id);
    }
    return m;
  };
}
