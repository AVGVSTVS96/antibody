export interface TextShape {
  words: number;
  /** "<enum> <heading>" of every section of the bill itself, skipping sections quoted into existing law. */
  sections: string[];
}

const SECTION = /<section\b[^>]*>\s*<enum>([^<]*)<\/enum>\s*<header\b[^>]*>([\s\S]*?)<\/header>/g;

export function textShape(xml: string): TextShape {
  const own = xml.replace(/<quoted-block\b[\s\S]*?<\/quoted-block>/g, " ");
  const sections = [...own.matchAll(SECTION)].map((m) => `${m[1]!.trim()} ${strip(m[2]!)}`);
  const words = strip(xml).split(" ").filter(Boolean).length;
  return { words, sections };
}

const strip = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const key = (section: string) =>
  section
    .replace(/^\S+\s/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Sections of `newest` whose heading appears nowhere in `previous` (renumbering alone doesn't count). */
export function newSections(previous: TextShape, newest: TextShape): string[] {
  const before = new Set(previous.sections.map(key));
  return newest.sections.filter((s) => !before.has(key(s)));
}

/** GovInfo bill XML runs about 13 bytes per word of text; used when only a Content-Length is known. */
export const wordsFromBytes = (bytes: number) => Math.round(bytes / 13);
