import type { Row } from "@antibody/core";
import { sameSection } from "./headings.ts";

/** A CBO row's section number and the label CBO printed beside it. */
export interface Labelled {
  num: string;
  title: string | null;
}

/** `(num, title, group)` gives the section id CBO's row is about, or undefined when no section with that number carries that heading. */
export type SectionJoin = (num: string, title: string | null, group?: boolean) => string | undefined;

/** A group's members are trusted by number when this share of the estimate's one-section rows match their headings. */
const VERIFIED = 0.6;

/**
 * CBO section numbers are the bill's own numbers in the version CBO scored, but the version BILLSTATUS names is not
 * always the one the numbers belong to (CBO's "As passed by the House" table for H.R.1 numbers some sections as
 * the Rules Committee print does). So a number joins to a section only when that section's heading in some
 * version also matches CBO's label; versions are tried best-fitting first, and a row that matches nowhere stays
 * unjoined instead of taking whatever section holds that number.
 */
export function sectionMap(sections: Row<"sections">[], code: string | null, rows: Labelled[] = []): SectionJoin {
  const byVersion = numberings(sections);
  const fits = (v: string, num: string, title: string | null) => {
    const s = byVersion(v).get(num);
    return s && sameSection(title, (s.history[v] as { heading?: string } | undefined)?.heading) ? s.id : undefined;
  };
  const codes = [...new Set(sections.flatMap((s) => Object.keys(s.history)))];
  const hits = new Map(codes.map((v) => [v, rows.filter((r) => fits(v, r.num, r.title)).length]));
  const order = [...codes].sort(
    (a, b) => hits.get(b)! - hits.get(a)! || Number(b === code) - Number(a === code) || a.localeCompare(b),
  );
  const verified = !!order.length && rows.length > 0 && hits.get(order[0]!)! / rows.length >= VERIFIED;
  return (num, title, group = false) => {
    for (const v of order) {
      const id = fits(v, num, title);
      if (id) return id;
    }
    return group && verified ? byVersion(order[0]!).get(num)?.id : undefined;
  };
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
  const seen = new Set<string>();
  const firstOfEachId = sections.filter((s) => !seen.has(s.id) && seen.add(s.id));
  const cache = new Map<string, Map<string, Row<"sections">>>();
  return (v: string) => {
    const cached = cache.get(v);
    if (cached) return cached;
    const m = new Map<string, Row<"sections">>();
    for (const s of firstOfEachId) {
      const path = (s.history[v] as { path?: string } | undefined)?.path;
      const num = path?.split("/").at(-1)?.replace(/^sec:/, "");
      if (num && !m.has(num)) m.set(num, s);
    }
    cache.set(v, m);
    return m;
  };
}
