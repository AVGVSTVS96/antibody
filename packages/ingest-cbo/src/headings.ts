const STOP = new Set(
  "a an the of and or for to in on by with from at as under act acts section sections sec secs title subtitle certain other related provisions provision".split(
    " ",
  ),
);

const STEM = 5;

/** Content words of a heading, lowercased and cut to a short stem so "oversight"/"oversee" and plurals line up. */
export function words(s: string | null | undefined): Set<string> {
  return new Set(
    (s ?? "")
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .split(/[^a-z0-9]+/)
      .filter((w) => w && !STOP.has(w))
      .map((w) => w.slice(0, STEM)),
  );
}

/**
 * Whether CBO's row label and a bill section's heading name the same thing: at least half of the shorter label's
 * content words appear in the other. CBO shortens and rewords headings, so equality would drop real matches,
 * while a wrong number almost never shares half its words with the wrong heading.
 */
export function sameSection(label: string | null, heading: string | null | undefined): boolean {
  const a = words(label);
  const b = words(heading);
  if (!a.size || !b.size) return false;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size) >= 0.5;
}
