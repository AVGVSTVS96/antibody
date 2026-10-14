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

const FILLER = new Set(["a", "an", "and", "for", "in", "of", "on", "or", "the", "to", "with"]);

const words = (section: string) =>
  new Set(
    section
      .replace(/^\S+\s/, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w && !FILLER.has(w)),
  );

/** Share of the shorter heading's words found in the other. */
const overlap = (a: Set<string>, b: Set<string>) => {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (Math.min(a.size, b.size) || 1);
};

/**
 * Sections of `newest` whose heading matches no heading in `previous` (at least 3/4 of the shorter one's words),
 * so renumbering or a lengthened heading ("Short title" → "Short title; table of contents") is not a new section.
 */
export function newSections(previous: TextShape, newest: TextShape): string[] {
  const before = previous.sections.map(words);
  return newest.sections.filter((s) => {
    const w = words(s);
    return !before.some((b) => overlap(w, b) >= 0.75);
  });
}

/** GovInfo bill XML runs about 13 bytes per word of text; used when only a Content-Length is known. */
export const wordsFromBytes = (bytes: number) => Math.round(bytes / 13);
