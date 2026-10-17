import type { Row } from "@antibody/core";
import { headingScore, sameSection, stems } from "./headings.ts";

/** A CBO row's section number and the label CBO printed beside it. */
export interface Labelled {
  num: string;
  title: string | null;
  division?: string | null;
}

/** Where CBO's table put a row: the division letter and title numeral it sits under, either of which can be unknown. */
export interface Place {
  division: string | null;
  title: string | null;
}

/**
 * `(num, title, group, division)` gives the section id CBO's row is about, or undefined when no section with that
 * number (in that division, when CBO's table names one) carries that heading.
 */
export type SectionJoin = (
  num: string,
  title: string | null,
  group?: boolean,
  division?: string | null,
) => string | undefined;

/** A section found through the hierarchy or a heading rather than a printed number. */
export interface Found {
  id: string;
  num: string;
  division: string | null;
  heading: string;
  /** The published version whose numbering and headings were used. */
  version: string;
}

export interface Places {
  /** The one section under `place` whose heading is CBO's `label`, or undefined unless exactly one fits clearly. */
  heading(label: string, place: Place): Found | undefined;
  /** Every section under `place` (a whole division or title), in section order. */
  under(place: Place): Found[];
}

/** A heading wins when it shares at least this many more words with CBO's label than the runner-up, or holds all of them and the runner-up doesn't. */
const MARGIN = 2;

/**
 * A group's members are trusted by number when this share of the estimate's one-section rows match their headings.
 * In such an estimate a single row also joins on a looser fit: the section holding its number shares with its label a
 * word that no other heading of that version has (CBO's "Munitions and Industrial Base" for "Enhancement of
 * Department of Defense resources for munitions and defense supply chain resiliency"). A number that is wrong
 * lands on a heading that shares only common words ("Medicaid").
 */
const VERIFIED = 0.6;

/**
 * CBO section numbers are the bill's own numbers in the version CBO scored, but the version BILLSTATUS names is not
 * always the one the numbers belong to (CBO's "As passed by the House" table for H.R.1 numbers some sections as
 * the Rules Committee print does). So a number joins to a section only when that section's heading in some
 * version also matches CBO's label; versions are tried best-fitting first, and a row that matches nowhere stays
 * unjoined instead of taking whatever section holds that number. Omnibus bills repeat numbers across divisions, so
 * when CBO's table names the division only that division's section can be the one.
 */
export function sectionMap(sections: Row<"sections">[], code: string | null, rows: Labelled[] = []): SectionJoin {
  return sectionIndex(sections, code, rows).join;
}

export function sectionIndex(
  sections: Row<"sections">[],
  code: string | null,
  rows: Labelled[] = [],
): { join: SectionJoin; places: Places } {
  const byVersion = numberings(sections);
  const candidates = (v: string, num: string, division: string | null | undefined) => {
    const all = byVersion(v).get(num) ?? [];
    const placed = all.filter((s) => at(s, v).division);
    return division && placed.length ? placed.filter((s) => at(s, v).division === division) : all;
  };
  const uses = new Map<string, Map<string, number>>();
  const useOf = (v: string) => {
    if (!uses.has(v)) {
      const count = new Map<string, number>();
      for (const s of uniqueById(sections))
        if (s.history[v]) for (const w of stems(at(s, v).heading)) count.set(w, (count.get(w) ?? 0) + 1);
      uses.set(v, count);
    }
    return uses.get(v)!;
  };
  /** Whether CBO's label and a heading share a word that no other heading of the version has. */
  const names = (v: string, label: string | null, heading: string) => {
    const count = useOf(v);
    return [...stems(label)].some((w) => stems(heading).has(w) && count.get(w) === 1);
  };
  const fits = (v: string, num: string, title: string | null, division?: string | null) => {
    const hits = candidates(v, num, division).filter((s) => sameSection(title, at(s, v).heading));
    return hits.length === 1 ? hits[0]!.id : undefined;
  };
  const codes = [...new Set(sections.flatMap((s) => Object.keys(s.history)))];
  const hits = new Map(codes.map((v) => [v, rows.filter((r) => fits(v, r.num, r.title, r.division)).length]));
  const order = [...codes].sort(
    (a, b) => hits.get(b)! - hits.get(a)! || Number(b === code) - Number(a === code) || a.localeCompare(b),
  );
  const verified = !!order.length && rows.length > 0 && hits.get(order[0]!)! / rows.length >= VERIFIED;
  const join: SectionJoin = (num, title, group = false, division = null) => {
    for (const v of order) {
      const id = fits(v, num, title, division);
      if (id) return id;
    }
    if (!verified) return undefined;
    const v = order[0]!;
    const trusted = candidates(v, num, division).filter((s) => group || names(v, title, at(s, v).heading));
    return trusted.length === 1 ? trusted[0]!.id : undefined;
  };
  return { join, places: placesOf(sections, order) };
}

/** Each version's sections that sit under a place, in the order the version numbers them. */
function placesOf(sections: Row<"sections">[], order: string[]): Places {
  const unique = uniqueById(sections);
  const under = (v: string, place: Place) =>
    unique
      .filter((s) => s.history[v])
      .map((s) => ({ s, at: at(s, v) }))
      .filter(
        ({ at }) =>
          (place.division ? at.division === place.division : !place.title || !at.division) &&
          (!place.title || at.title === place.title),
      );
  const found = (v: string, x: { s: Row<"sections">; at: ReturnType<typeof at> }): Found => ({
    id: x.s.id,
    num: x.at.num,
    division: x.at.division,
    heading: x.at.heading,
    version: v,
  });
  return {
    under(place) {
      for (const v of order) {
        const here = under(v, place);
        if (here.length)
          return here.map((x) => found(v, x)).sort((a, b) => a.num.localeCompare(b.num, "en", { numeric: true }));
      }
      return [];
    },
    heading(label, place) {
      for (const v of order) {
        const scored = under(v, place)
          .map((x) => ({ x, ...headingScore(label, x.at.heading) }))
          .filter((c) => c.shared > 0)
          .sort((a, b) => b.shared - a.shared);
        const [best, next] = scored;
        if (best?.confident && (!next || best.shared - next.shared >= MARGIN || (best.whole && !next.whole)))
          return found(v, best.x);
      }
      return undefined;
    },
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

/** A section's place in one version: its number, heading, and the division and title above it. */
function at(s: Row<"sections">, v: string) {
  const h = s.history[v] as { path?: string; heading?: string } | undefined;
  const parts = h?.path?.split("/") ?? [];
  const part = (kind: string) => parts.find((p) => p.startsWith(`${kind}:`))?.slice(kind.length + 1) ?? null;
  return {
    num: part("sec") ?? "",
    heading: h?.heading ?? "",
    division: part("division"),
    title: part("title"),
  };
}

function uniqueById(sections: Row<"sections">[]) {
  const seen = new Set<string>();
  return sections.filter((s) => !seen.has(s.id) && seen.add(s.id));
}

function numberings(sections: Row<"sections">[]) {
  const firstOfEachId = uniqueById(sections);
  const cache = new Map<string, Map<string, Row<"sections">[]>>();
  return (v: string) => {
    const cached = cache.get(v);
    if (cached) return cached;
    const m = new Map<string, Row<"sections">[]>();
    for (const s of firstOfEachId) {
      const num = at(s, v).num;
      if (num && s.history[v]) m.set(num, [...(m.get(num) ?? []), s]);
    }
    cache.set(v, m);
    return m;
  };
}
