import type { Row } from "@antibody/core";
import { must } from "@antibody/core";
import { cached } from "./fetch.ts";
import { isStepRef, PASSED } from "./lineage.ts";
import type { StepRef } from "./lineage.ts";
import { deleted, headerOf, label, parseSections, sectionElements, sectionText } from "./sections.ts";
import type { Sec } from "./sections.ts";
import { intersect, normEnum, shingles, words } from "./text.ts";
import { versionFile } from "./versions.ts";
import type { Element } from "./xml.ts";
import { isElement, kids, local, textOf } from "./xml.ts";

export const PARTS = {
  version: "parts-v1",
  splitOver: 500,
  pieceOver: 1000,
  leadInMin: 40,
  carried: 0.5,
} as const;

export const PARTS_TEXT = [
  `A section longer than ${PARTS.splitOver} words (about two printed pages) is read in parts: its labeled subdivisions (subsections, then paragraphs, subparagraphs, clauses and so on down), each split again while it is still longer than ${PARTS.pieceOver.toLocaleString("en-US")} words and has subdivisions of its own. A dropped section is read in the last text it was in. A split piece's own words outside its subdivisions (a lead-in or closing paragraph) are a part of their own when they run to ${PARTS.leadInMin} words or more. Text the section inserts into other law (a quoted block) is read as part of the subdivision that inserts it, not split further.`,
  `A part first appears in the earliest version of the bill where at least ${PARTS.carried * 100}% of its wording (counted in runs of five words) is already in the same section, or in the section it was split out of. A part is added late when that version is the first one a chamber passed or later, the same test the section lineage uses; a part of a section the bill's first text already had can be late, which is how a rider written into an old section shows.`,
  "A part has no dollars of its own (CBO prices whole sections) and no lobbying of its own (lobbying reports name section numbers); its stakes come from its own text's reach. Its attention is the share of articles the matcher tied to the part; an article tied to a part counts for its section too.",
];

const LEVELS = new Set(["subsection", "paragraph", "subparagraph", "clause", "subclause", "item", "subitem"]);

export interface Piece {
  enum: string;
  heading: string;
  trail: string[];
  path: string;
  text: string;
  words: number;
  leadIn: boolean;
}

const plain = (e: string) => normEnum(e).replaceAll(/^\(|\)$/gu, "");
const paren = (e: string) => (e ? `(${plain(e)})` : "(?)");

function ownText(el: Element): string {
  return sectionText({ children: el.children.filter((c) => !(isElement(c) && LEVELS.has(local(c)))) });
}

export function splitSection(section: Element): Piece[] {
  if (words(sectionText(section)) <= PARTS.splitOver) {
    return [];
  }

  const out: Piece[] = [];

  const rec = (el: Element, en: string, path: string, trail: string[], top: boolean) => {
    const text = sectionText(el);
    const subs = kids(el).filter((c) => LEVELS.has(local(c)) && !deleted(c));
    const heading = top ? "" : headerOf(el).replace(/[\s.:-]+$/u, "");

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
  id: string;
  sectionId: string;
  num: string;
  firstVersion: string;
  late: boolean;
  version: string;
  url: string;
}

type SectionRow = Pick<Row<"sections">, "id" | "num" | "words" | "history" | "split_from" | "first_version">;

type VersionRow = Pick<Row<"versions">, "code" | "url" | "predecessor_rule">;

const findStep = <T extends StepRef>(secs: T[], step: StepRef) =>
  secs.find((x) => x.hash === step.hash) ?? secs.find((x) => x.path === step.path);

const stepAt = (s: SectionRow, code: string) => {
  const step = s.history[code];

  return isStepRef(step) ? step : undefined;
};

export function carriedShare(part: Set<string>, text: Set<string>): number {
  return part.size ? intersect(part, text) / part.size : 0;
}

export async function sectionParts(
  sections: SectionRow[],
  versions: VersionRow[],
  opts: { lateUnavailable?: string | null; read?: (url: string) => Promise<string> } = {},
): Promise<SectionPart[]> {
  const read = opts.read ?? (async (url: string) => await cached(url, versionFile(url)));
  const codes = versions.map((v) => v.code);
  const urlOf = new Map(versions.map((v) => [v.code, v.url]));

  const long = sections.flatMap((s) => {
    const last = Object.keys(s.history).at(-1);
    const url = last === undefined ? undefined : urlOf.get(last);

    return s.words > PARTS.splitOver && last !== undefined && url !== undefined ? [{ s, last, url }] : [];
  });

  if (!long.length) {
    return [];
  }

  const xml = new Map<string, string>();

  const textOfVersion = async (code: string) => {
    let text = xml.get(code);

    if (text === undefined) {
      text = await read(must(urlOf.get(code), `the URL of ${code}`));
      xml.set(code, text);
    }

    return text;
  };

  const parsed = new Map<string, Sec[]>();

  const secsOf = async (code: string) => {
    let secs = parsed.get(code);

    if (secs === undefined) {
      secs = urlOf.has(code) ? parseSections(await textOfVersion(code)) : [];
      parsed.set(code, secs);
    }

    return secs;
  };

  const byId = new Map(sections.map((s) => [s.id, s]));

  const earlier = async (s: SectionRow, upTo: string) => {
    const out = new Map<string, Set<string>>();
    const from = s.split_from === null ? undefined : byId.get(s.split_from);

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

        const hit = findStep(await secsOf(code), step);

        if (hit) {
          out.set(code, hit.sh);
        }
      }
    }

    return out;
  };

  const ownStart = versions.findIndex((v) => v.predecessor_rule === null || v.predecessor_rule === "");
  const passed = codes.findIndex((c) => PASSED.has(c));

  const isLate = (code: string) => {
    const i = codes.indexOf(code);

    return (opts.lateUnavailable ?? "") === "" && passed !== -1 && i > ownStart && i >= passed;
  };

  const elements = new Map<string, { el: Element; path: string; hash: string }[]>();

  const elementsOf = async (code: string) => {
    let found = elements.get(code);

    if (found === undefined) {
      const secs = await secsOf(code);
      found = sectionElements(await textOfVersion(code)).map((x, i) => ({ ...x, hash: secs[i]?.hash ?? "" }));
      elements.set(code, found);
    }

    return found;
  };

  const out: SectionPart[] = [];

  for (const { s, last, url } of long) {
    const step = stepAt(s, last);
    const el = step === undefined ? undefined : findStep(await elementsOf(last), step)?.el;

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

      const first =
        codes.find((c) => {
          const prior = before.get(c);

          return prior !== undefined && carriedShare(sh, prior) >= PARTS.carried;
        }) ?? last;

      out.push({
        ...p,
        id: `${s.id}${p.enum}${p.leadIn ? "~lead" : ""}${n > 1 ? `~${n}` : ""}`,
        sectionId: s.id,
        num: `${s.num}${p.enum}`,
        firstVersion: first,
        late: isLate(first),
        version: last,
        url,
      });
    }
  }

  return out;
}
