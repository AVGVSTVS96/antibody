import type { Row } from "@antibody/core";

/**
 * CBO section numbers are the bill's own numbers in the version CBO scored ("Sec. 70101" = `sec:70101` in the
 * enrolled text). Numbers change between versions, so the join goes through that version's path in each
 * section lineage, never the number alone.
 */
export function sectionMap(sections: Row<"sections">[], code: string | null): (num: string) => string | undefined {
  const byVersion = (v: string) => {
    const m = new Map<string, string>();
    for (const s of sections) {
      const path = (s.history[v] as { path?: string } | undefined)?.path;
      const num = path?.split("/").at(-1)?.replace(/^sec:/, "");
      if (num && !m.has(num)) m.set(num, s.id);
    }
    return m;
  };
  let m = code ? byVersion(code) : new Map<string, string>();
  if (!m.size && code === "enr") m = byVersion("plaw");
  return (num) => m.get(num);
}
