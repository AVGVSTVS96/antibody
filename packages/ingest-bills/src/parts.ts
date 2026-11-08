import type { Row } from "@antibody/core";
import { cached } from "./fetch.ts";
import { PASSED } from "./lineage.ts";
import { deleted, headerOf, label, parseSections, sectionElements, sectionText } from "./sections.ts";
import type { Sec } from "./sections.ts";
import { intersect, normEnum, shingles, words } from "./text.ts";
import { versionFile } from "./versions.ts";
import type { Element } from "./xml.ts";
import { kids, local, textOf } from "./xml.ts";

/**
 * parts-v1: a long section is read in its own pieces, so a provision buried in it is seen on its own. One rule for
 * every bill and party; every number is here and in PARTS_TEXT.
 */
export const PARTS = {
  version: "parts-v1",
  /** A section longer than this (about two printed pages) is read in its labeled subdivisions. */
  splitOver: 500,
  /** A subdivision longer than this is split again into its own. */
  pieceOver: 1000,
  /** Text a split piece has outside its subdivisions (a lead-in, a closing flush paragraph) is its own part from this long. */
  leadInMin: 40,
  /** A part is in an earlier text when at least this share of its 5-word runs is in the section there. */
  carried: 0.5,
} as const;

export const PARTS_TEXT = [
  `A section longer than ${PARTS.splitOver} words (about two printed pages) is read in parts: its labeled subdivisions (subsections, then paragraphs, subparagraphs, clauses and so on down), each split again while it is still longer than ${PARTS.pieceOver.toLocaleString("en-US")} words and has subdivisions of its own. A dropped section is read in the last text it was in. A split piece's own words outside its subdivisions (a lead-in or closing paragraph) are a part of their own when they run to ${PARTS.leadInMin} words or more. Text the section inserts into other law (a quoted block) is read as part of the subdivision that inserts it, not split further.`,
  `A part first appears in the earliest version of the bill where at least ${PARTS.carried * 100}% of its wording (counted in runs of five words) is already in the same section, or in the section it was split out of. A part is added late when that version is the first one a chamber passed or later, the same test the section lineage uses; a part of a section the bill's first text already had can be late, which is how a rider written into an old section shows.`,
  "A part has no dollars of its own (CBO prices whole sections) and no lobbying of its own (lobbying reports name section numbers); its stakes come from its own text's reach. Its attention is the share of articles the matcher tied to the part; an article tied to a part counts for its section too.",
];

const LEVELS = new Set(["subsection", "paragraph", "subparagraph", "clause", "subclause", "item", "subitem"]);

/** One piece of a long section, as read from one text version. */
export interface Piece {
  /** `(a)(12)` */
  enum: string;
  heading: string;
  /** Headings of the pieces it sits in, outermost first (the section's own heading is not included). */
  trail: string[];
  /** `subsection:a/paragraph:12` */
  path: string;
  text: string;
  words: number;
  /** A lead-in or closing text of a split piece, not one of its labeled subdivisions. */
  leadIn: boolean;
}

const plain = (e: string) => normEnum(e).replaceAll(/^\(|\)$/g, "");
const paren = (e: string) => (e ? `(${plain(e)})` : "(?)");

/** The words of a piece that sit outside its labeled subdivisions. */
function ownText(el: Element): string {
  const clone = { ...el, children: el.children.filter((c) => !(c.type === "tag" && LEVELS.has(local(c)))) };

  return sectionText(clone as Element);
}

/** The parts of a section element: empty when it is short enough to read whole. */
export function splitSection(section: Element): Piece[] {
  if (words(sectionText(section)) <= PARTS.splitOver) {
    return [];
  }

  const out: Piece[] = [];

  const rec = (el: Element, en: string, path: string, trail: string[], top: boolean) => {
    const text = sectionText(el);
    const subs = kids(el).filter((c) => LEVELS.has(local(c)) && !deleted(c));
    const heading = top ? "" : headerOf(el).replace(/[\s.:-]+$/, "");

    if (!top && (words(text) <= PARTS.pieceOver || subs.length < 2)) {
      out.push({ enum: en, heading, trail, path, text, words: words(text), leadIn: false });

      return;
    }

    if (subs.length < 2) {
      return;
    }

    const own = ownText(el);

    if (!top && words(own) >= PARTS.leadInMin) {
      out.push({ enum: en, heading, trail, path, text: own, words: words(own), leadIn: true });
    } else if (top && words(own) >= PARTS.leadInMin) {
      out.push({ enum: "", heading: "", trail: [], path: "", text: own, words: words(own), leadIn: true });
    }

    const inner = top ? trail : [...trail, heading].filter(Boolean);

    for (const c of subs) {
      const l = label(c);
      const e = paren(l ? textOf(l) : "");
      rec(c, `${en}${e}`, `${path ? `${path}/` : ""}${local(c)}:${plain(e)}`, inner, false);
    }
  };

  rec(section, "", "", [], true);

  return out.length > 1 ? out : [];
}

export interface SectionPart extends Piece {
  /** `<section id><enum>`, with `~2`, `~3` … when a text repeats an enum. */
  id: string;
  sectionId: string;
  /** `4(a)(12)` */
  num: string;
  /** The version the part's wording first appears in (see PARTS_TEXT). */
  firstVersion: string;
  late: boolean;
  /** The version code and URL the part is read from: the final text, or the last one a dropped section was in. */
  version: string;
  url: string;
}

type SectionRow = Pick<Row<"sections">, "id" | "num" | "words" | "history" | "split_from" | "first_version">;

type VersionRow = Pick<Row<"versions">, "code" | "url" | "predecessor_rule">;

/** Share of a part's 5-word runs found in a text. */
export function carriedShare(part: Set<string>, text: Set<string>): number {
  return part.size ? intersect(part, text) / part.size : 0;
}

/**
 * Every long section's parts, read from the text it was last seen in (the final text, or for a dropped section the
 * last text it was in, so a page can say what a dropped rider did); each part's first version comes from the
 * section's earlier texts and those of the section it was split out of. `lateUnavailable` withholds late flags for
 * the whole bill, as it does for sections.
 */
export async function sectionParts(
  sections: SectionRow[],
  versions: VersionRow[],
  opts: { lateUnavailable?: string | null; read?: (url: string) => Promise<string> } = {},
): Promise<SectionPart[]> {
  const read = opts.read ?? (async (url: string) => cached(url, versionFile(url)));
  const codes = versions.map((v) => v.code);
  const urlOf = new Map(versions.map((v) => [v.code, v.url]));
  const lastOf = (s: SectionRow) => Object.keys(s.history).at(-1)!;
  const long = sections.filter((s) => s.words > PARTS.splitOver && urlOf.has(lastOf(s)));

  if (!long.length) {
    return [];
  }

  const xml = new Map<string, string>();

  const textOfVersion = async (code: string) => {
    if (!xml.has(code)) {
      xml.set(code, await read(urlOf.get(code)!));
    }

    return xml.get(code)!;
  };

  const parsed = new Map<string, Sec[]>();

  const secsOf = async (code: string) => {
    if (!parsed.has(code)) {
      parsed.set(code, urlOf.has(code) ? parseSections(await textOfVersion(code)) : []);
    }

    return parsed.get(code)!;
  };

  const byId = new Map(sections.map((s) => [s.id, s]));
  const stepAt = (s: SectionRow, code: string) => s.history[code] as { path: string; hash: string } | undefined;

  const find = <T extends { path: string; hash: string }>(secs: T[], step: { path: string; hash: string }) =>
    secs.find((x) => x.hash === step.hash) ?? secs.find((x) => x.path === step.path);

  /** The section's wording in each version before `upTo` it (or the section it was split from) was in. */
  const earlier = async (s: SectionRow, upTo: string) => {
    const out = new Map<string, Set<string>>();
    const from = s.split_from ? byId.get(s.split_from) : undefined;

    for (const [owner, until] of [
      [s, upTo],
      [from, s.first_version],
    ] as const) {
      if (!owner) {
        continue;
      }

      for (const code of codes.slice(0, codes.indexOf(until))) {
        const step = stepAt(owner, code);

        if (!step || out.has(code)) {
          continue;
        }

        const hit = find(await secsOf(code), step);

        if (hit) {
          out.set(code, hit.sh);
        }
      }
    }

    return out;
  };

  const ownStart = versions.findIndex((v) => !v.predecessor_rule);
  const passed = codes.findIndex((c) => PASSED.has(c));

  const isLate = (code: string) => {
    const i = codes.indexOf(code);

    return !opts.lateUnavailable && passed !== -1 && i > ownStart && i >= passed;
  };

  const elements = new Map<string, { el: Element; path: string; hash: string }[]>();

  const elementsOf = async (code: string) => {
    if (!elements.has(code)) {
      const secs = await secsOf(code);
      elements.set(
        code,
        sectionElements(await textOfVersion(code)).map((x, i) => ({ ...x, hash: secs[i]?.hash ?? "" })),
      );
    }

    return elements.get(code)!;
  };

  const out: SectionPart[] = [];

  for (const s of long) {
    const last = lastOf(s);
    const step = stepAt(s, last);
    const el = step && find(await elementsOf(last), step)?.el;

    if (!el) {
      continue;
    }

    const pieces = splitSection(el);

    if (!pieces.length) {
      continue;
    }

    const before = await earlier(s, last);
    const seen = new Map<string, number>();

    for (const p of pieces) {
      const key = p.leadIn ? `${p.enum}~lead` : p.enum;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      const sh = shingles(p.text);
      const first = codes.find((c) => before.has(c) && carriedShare(sh, before.get(c)!) >= PARTS.carried) ?? last;
      out.push({
        ...p,
        id: `${s.id}${p.enum}${p.leadIn ? "~lead" : ""}${n > 1 ? `~${n}` : ""}`,
        sectionId: s.id,
        num: `${s.num}${p.enum}`,
        firstVersion: first,
        late: isLate(first),
        version: last,
        url: urlOf.get(last)!,
      });
    }
  }

  return out;
}
