export interface TextShape {
  words: number;
  sections: string[];
}

const SECTION = /<section\b[^>]*>\s*<enum>([^<]*)<\/enum>\s*<header\b[^>]*>([\s\S]*?)<\/header>/gu;

export function textShape(xml: string): TextShape {
  const own = xml.replaceAll(/<quoted-block\b[\s\S]*?<\/quoted-block>/gu, " ");
  const sections = [...own.matchAll(SECTION)].map(([, num = "", header = ""]) => `${num.trim()} ${strip(header)}`);

  const words = strip(xml)
    .split(" ")
    .filter((w) => w !== "").length;

  return { words, sections };
}

const strip = (s: string) =>
  s
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();

const FILLER = new Set(["a", "an", "and", "for", "in", "of", "on", "or", "the", "to", "with"]);

const words = (section: string) =>
  new Set(
    section
      .replace(/^\S+\s/u, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((w) => w !== "" && !FILLER.has(w)),
  );

const overlap = (a: Set<string>, b: Set<string>) => {
  let shared = 0;

  for (const w of a) {
    if (b.has(w)) {
      shared++;
    }
  }

  return shared / (Math.min(a.size, b.size) || 1);
};

export function newSections(previous: TextShape, newest: TextShape): string[] {
  const before = previous.sections.map(words);

  return newest.sections.filter((s) => {
    const w = words(s);

    return !before.some((b) => overlap(w, b) >= 0.75);
  });
}

const GOVINFO_XML_BYTES_PER_WORD = 13;

export const wordsFromBytes = (bytes: number) => Math.round(bytes / GOVINFO_XML_BYTES_PER_WORD);
