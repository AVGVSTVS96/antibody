const SPACES = /[  -​  ]/gu;

const QUOTES = new Map([
  ["“", '"'],
  ["”", '"'],
  ["‘", "'"],
  ["’", "'"],
  ["—", "-"],
  ["–", "-"],
  ["`", "'"],
]);

export function norm(s: string): string {
  return s
    .replaceAll(/[“”‘’—–`]/gu, (c) => QUOTES.get(c) ?? c)
    .replaceAll(SPACES, " ")
    .replaceAll("''", '"')
    .replaceAll(/\s+/gu, " ")
    .trim();
}

export function canon(s: string): string {
  const spaced = s.replaceAll(/[¼-¾⅐-⅞]/gu, (c) => ` ${c.normalize("NFKC")}`);

  return (
    spaced
      .normalize("NFKC")
      .toLowerCase()
      .match(/[a-z0-9]+/gu) ?? []
  ).join(" ");
}

export function normHeading(s: string): string {
  return norm(s)
    .replace(/[.\s]+$/u, "")
    .toLowerCase();
}

export function normEnum(s: string): string {
  return norm(s)
    .replace(/^["' ]+/u, "")
    .replace(/^(SECTION|SEC\.|TITLE|SUBTITLE|PART|SUBPART|CHAPTER|SUBCHAPTER|DIVISION)\s*/iu, "")
    .replaceAll(/^[ .\-—]+|[ .\-—]+$/gu, "");
}

export function words(s: string): number {
  return s ? s.split(" ").length : 0;
}

export function shingles(text: string, k = 5): Set<string> {
  const w = canon(text).split(" ").filter(Boolean);

  if (w.length < k) {
    return new Set(w.length ? [w.join(" ")] : []);
  }

  const out = new Set<string>();

  for (let i = 0; i + k <= w.length; i++) {
    out.add(w.slice(i, i + k).join(" "));
  }

  return out;
}

const STOP = new Set(
  "a an and the of for in on to with by or from under as at relating respect certain other".split(" "),
);

export function headingWords(h: string): Set<string> {
  return new Set((h.toLowerCase().match(/[a-z]+/gu) ?? []).filter((w) => !STOP.has(w)).map((w) => w.slice(0, 6)));
}

const CITES: [RegExp, (g: string[]) => string][] = [
  [/(\d+) U\.\s?S\.\s?C\.\s?(\d+[a-z0-9-]*)/gu, ([t, s]) => `usc:${t}:${s}`],
  [/[Ss]ection (\d+[A-Z]*)(?:\([^)]*\))* of (?:the )?(?:Internal Revenue Code|such Code)/gu, ([s]) => `irc:${s}`],
  [/[Ss]ection (\d+[A-Za-z]*)(?:\([^)]*\))* of Public Law (\d+[-–]\d+)/gu, ([s, pl]) => `pl:${pl}:${s}`],
  [
    /[Ss]ection (\d+[A-Za-z]*)(?:\([^)]*\))* of the ((?:[A-Z][\w.,'-]* )+?Act(?: of \d{4})?)/gu,
    ([s, act]) => `act:${act}:${s}`,
  ],
];

export function citations(text: string): Set<string> {
  const t = text.replaceAll(/(?:has|have|had) the meanings? given[^.;]*/gu, "");
  const out = new Set<string>();

  for (const [rx, fmt] of CITES) {
    for (const m of t.matchAll(rx)) {
      out.add(fmt(m.slice(1).map((g) => g.replaceAll("–", "-").toLowerCase())));
    }
  }

  return out;
}

export function intersect<T>(a: Set<T>, b: Set<T>): number {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let n = 0;

  for (const x of small) {
    if (big.has(x)) {
      n++;
    }
  }

  return n;
}
