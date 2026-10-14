const SPACES = /[  -​  ]/g;
const QUOTES: Record<string, string> = { "“": '"', "”": '"', "‘": "'", "’": "'", "—": "-", "–": "-", "`": "'" };

/** Straight quotes, plain dashes and single spaces: how text is stored and shown. */
export function norm(s: string): string {
  return s
    .replace(/[“”‘’—–`]/g, (c) => QUOTES[c]!)
    .replace(SPACES, " ")
    .replaceAll("''", '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Lowercase alphanumeric tokens: what hashing, shingles and word diffs compare. */
export function canon(s: string): string {
  const spaced = s.replace(/[¼-¾⅐-⅞]/g, (c) => ` ${c.normalize("NFKC")}`);
  return (
    spaced
      .normalize("NFKC")
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? []
  ).join(" ");
}

export function normHeading(s: string): string {
  return norm(s)
    .replace(/[.\s]+$/, "")
    .toLowerCase();
}

/**
 * Runs of two or more capitalized words in mid-sentence ("Jeffrey Epstein", "Department of Energy"), keyed by their
 * lowercase form: the names a text spells out. GPO prints some headings in lowercase even for these.
 */
export function namesIn(texts: Iterable<string | null>): Map<string, string> {
  const names = new Map<string, string>();
  for (const t of texts)
    for (const m of (t ?? "").matchAll(/(?<=[a-z,] )[A-Z][a-z]+(?:(?: of| and| for)? [A-Z][a-z]+)+/g))
      names.set(m[0].toLowerCase(), m[0]);
  return names;
}

/** `heading` with each of `names` spelled as given. */
export function capitalizeNames(heading: string, names: Map<string, string>): string {
  let out = heading;
  for (const [lower, cased] of names) {
    const at = out.toLowerCase().indexOf(lower);
    const edge = (i: number) => !/[A-Za-z]/.test(out[i] ?? " ");
    if (at >= 0 && edge(at - 1) && edge(at + lower.length))
      out = out.slice(0, at) + cased + out.slice(at + lower.length);
  }
  return out;
}

/** `SEC. 70114.` → `70114`, `TITLE VII—` → `VII`. */
export function normEnum(s: string): string {
  return norm(s)
    .replace(/^["' ]+/, "")
    .replace(/^(SECTION|SEC\.|TITLE|SUBTITLE|PART|SUBPART|CHAPTER|SUBCHAPTER|DIVISION)\s*/i, "")
    .replace(/^[ .\-—]+|[ .\-—]+$/g, "");
}

export function words(s: string): number {
  return s ? s.split(" ").length : 0;
}

/** Every 5-word run of the canonical text (or the whole text when shorter). */
export function shingles(text: string, k = 5): Set<string> {
  const w = canon(text).split(" ").filter(Boolean);
  if (w.length < k) return new Set(w.length ? [w.join(" ")] : []);
  const out = new Set<string>();
  for (let i = 0; i + k <= w.length; i++) out.add(w.slice(i, i + k).join(" "));
  return out;
}

const STOP = new Set(
  "a an and the of for in on to with by or from under as at relating respect certain other".split(" "),
);

/** Heading words cut to 6 letters, so "modification" and "modifications" meet. */
export function headingWords(h: string): Set<string> {
  return new Set((h.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => !STOP.has(w)).map((w) => w.slice(0, 6)));
}

const CITES: [RegExp, (g: string[]) => string][] = [
  [/(\d+) U\.\s?S\.\s?C\.\s?(\d+[a-z0-9-]*)/g, ([t, s]) => `usc:${t}:${s}`],
  [/[Ss]ection (\d+[A-Z]*)(?:\([^)]*\))* of (?:the )?(?:Internal Revenue Code|such Code)/g, ([s]) => `irc:${s}`],
  [/[Ss]ection (\d+[A-Za-z]*)(?:\([^)]*\))* of Public Law (\d+[-–]\d+)/g, ([s, pl]) => `pl:${pl}:${s}`],
  [
    /[Ss]ection (\d+[A-Za-z]*)(?:\([^)]*\))* of the ((?:[A-Z][\w.,'-]* )+?Act(?: of \d{4})?)/g,
    ([s, act]) => `act:${act}:${s}`,
  ],
];

/** Provisions of law a section amends or cites (USC, IRC, Public Law, named Acts); definition cross-references are left out. */
export function citations(text: string): Set<string> {
  const t = text.replace(/(?:has|have|had) the meanings? given[^.;]*/g, "");
  const out = new Set<string>();
  for (const [rx, fmt] of CITES)
    for (const m of t.matchAll(rx)) out.add(fmt(m.slice(1).map((g) => g.replaceAll("–", "-").toLowerCase())));
  return out;
}

export function intersect<T>(a: Set<T>, b: Set<T>): number {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let n = 0;
  for (const x of small) if (big.has(x)) n++;
  return n;
}
