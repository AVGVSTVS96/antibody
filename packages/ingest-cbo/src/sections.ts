import type { Row } from "@antibody/core";
import { filled } from "@antibody/core";
import { headingScore, sameSection, stems } from "./headings.ts";

export type SectionRow = Pick<Row<"sections">, "id" | "history">;

export interface Labelled {
  num: string;
  title: string | null;
  division?: string | null;
}

export interface Place {
  division: string | null;
  title: string | null;
}

export type SectionJoin = (
  num: string,
  title: string | null,
  group?: boolean,
  division?: string | null,
) => string | undefined;

export interface Found {
  id: string;
  num: string;
  division: string | null;
  heading: string;
  version: string;
}

export interface Places {
  heading: (label: string, place: Place) => Found | undefined;
  under: (place: Place) => Found[];
}

const MARGIN = 2;

const VERIFIED = 0.6;

export function sectionMap(sections: SectionRow[], code: string | null, rows: Labelled[] = []): SectionJoin {
  return sectionIndex(sections, code, rows).join;
}

export function sectionIndex(sections: SectionRow[], code: string | null, rows: Labelled[] = []) {
  const byVersion = numberings(sections);

  const candidates = (v: string, num: string, division: string | null | undefined) => {
    const all = byVersion(v).get(num) ?? [];
    const placed = all.filter((s) => filled(at(s, v).division));

    return filled(division) && placed.length > 0 ? placed.filter((s) => at(s, v).division === division) : all;
  };

  const uses = new Map<string, Map<string, number>>();

  const stemCounts = (v: string) => {
    let count = uses.get(v);

    if (count === undefined) {
      count = new Map<string, number>();

      for (const s of uniqueById(sections)) {
        if (inVersion(s, v)) {
          for (const w of stems(at(s, v).heading)) {
            count.set(w, (count.get(w) ?? 0) + 1);
          }
        }
      }

      uses.set(v, count);
    }

    return count;
  };

  const names = (v: string, label: string | null, heading: string) => {
    const count = stemCounts(v);

    return [...stems(label)].some((w) => stems(heading).has(w) && count.get(w) === 1);
  };

  const fits = (v: string, num: string, title: string | null, division?: string | null) => {
    const hits = candidates(v, num, division).filter((s) => sameSection(title, at(s, v).heading));

    return hits.length === 1 ? hits[0]?.id : undefined;
  };

  const codes = [...new Set(sections.flatMap((s) => Object.keys(s.history)))];

  const hits = new Map(
    codes.map((v) => [v, rows.filter((r) => fits(v, r.num, r.title, r.division) !== undefined).length]),
  );

  const order = codes.toSorted(
    (a, b) => (hits.get(b) ?? 0) - (hits.get(a) ?? 0) || Number(b === code) - Number(a === code) || a.localeCompare(b),
  );

  const best = order[0];
  const verified = best !== undefined && rows.length > 0 && (hits.get(best) ?? 0) / rows.length >= VERIFIED;

  const join: SectionJoin = (num, title, group = false, division = null) => {
    for (const v of order) {
      const id = fits(v, num, title, division);

      if (id !== undefined) {
        return id;
      }
    }

    if (!verified) {
      return;
    }

    const trusted = candidates(best, num, division).filter((s) => group || names(best, title, at(s, best).heading));

    return trusted.length === 1 ? trusted[0]?.id : undefined;
  };

  return { join, places: placesOf(sections, order) };
}

const found = (v: string, x: { s: SectionRow; at: ReturnType<typeof at> }): Found => ({
  id: x.s.id,
  num: x.at.num,
  division: x.at.division,
  heading: x.at.heading,
  version: v,
});

const isUnder = (where: ReturnType<typeof at>, place: Place) =>
  (filled(place.division) ? where.division === place.division : !filled(place.title) || !filled(where.division)) &&
  (!filled(place.title) || where.title === place.title);

function placesOf(sections: SectionRow[], order: string[]): Places {
  const unique = uniqueById(sections);

  const under = (v: string, place: Place) =>
    unique.flatMap((s) => {
      const where = inVersion(s, v) ? at(s, v) : undefined;

      return where && isUnder(where, place) ? [{ s, at: where }] : [];
    });

  return {
    under(place) {
      for (const v of order) {
        const here = under(v, place);

        if (here.length) {
          return here.map((x) => found(v, x)).toSorted((a, b) => a.num.localeCompare(b.num, "en", { numeric: true }));
        }
      }

      return [];
    },
    heading(label, place) {
      for (const v of order) {
        const scored = under(v, place)
          .map((x) => ({ x, ...headingScore(label, x.at.heading) }))
          .filter((c) => c.shared > 0)
          .toSorted((a, b) => b.shared - a.shared);

        const [best, next] = scored;

        if (best?.confident === true && (!next || best.shared - next.shared >= MARGIN || (best.whole && !next.whole))) {
          return found(v, best.x);
        }
      }
    },
  };
}

export function closestVersion(
  sections: SectionRow[],
  nums: string[],
  codes: string[],
): { code: string; covered: number } | null {
  const byVersion = numberings(sections);
  const unique = [...new Set(nums)];

  if (unique.length < 5) {
    return null;
  }

  const best = codes
    .map((code) => {
      const m = byVersion(code);

      return { code, covered: unique.filter((n) => m.has(n)).length };
    })
    .toSorted((a, b) => b.covered - a.covered)[0];

  return best && best.covered / unique.length >= 0.95 ? best : null;
}

export const hasPath = (step: unknown): step is { path: string } =>
  typeof step === "object" && step !== null && "path" in step && typeof step.path === "string";

export const hasHeading = (step: unknown): step is { heading: string } =>
  typeof step === "object" && step !== null && "heading" in step && typeof step.heading === "string";

const inVersion = (s: SectionRow, v: string) => s.history[v] !== undefined;

function at(s: SectionRow, v: string) {
  const step = s.history[v];
  const parts = hasPath(step) ? step.path.split("/") : [];
  const part = (kind: string) => parts.find((p) => p.startsWith(`${kind}:`))?.slice(kind.length + 1) ?? null;

  return {
    num: part("sec") ?? "",
    heading: hasHeading(step) ? step.heading : "",
    division: part("division"),
    title: part("title"),
  };
}

function uniqueById(sections: SectionRow[]) {
  const seen = new Set<string>();

  return sections.filter((s) => {
    if (seen.has(s.id)) {
      return false;
    }

    seen.add(s.id);

    return true;
  });
}

function numberings(sections: SectionRow[]) {
  const firstOfEachId = uniqueById(sections);
  const cache = new Map<string, Map<string, SectionRow[]>>();

  return (v: string) => {
    const cached = cache.get(v);

    if (cached) {
      return cached;
    }

    const m = new Map<string, SectionRow[]>();

    for (const s of firstOfEachId) {
      const num = at(s, v).num;

      if (num !== "" && inVersion(s, v)) {
        m.set(num, [...(m.get(num) ?? []), s]);
      }
    }

    cache.set(v, m);

    return m;
  };
}
