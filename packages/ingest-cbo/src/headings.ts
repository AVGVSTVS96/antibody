const STOP = new Set(
  "a an the of and or for to in on by with from at as under act acts section sections sec secs title subtitle certain other related provisions provision".split(
    " ",
  ),
);

const STEM = 5;

export function words(s: string | null | undefined): Set<string> {
  return new Set(
    (s ?? "")
      .toLowerCase()
      .replaceAll(/\([^)]*\)/gu, " ")
      .split(/[^a-z0-9]+/u)
      .filter((w) => w !== "" && !STOP.has(w))
      .map((w) => w.slice(0, STEM)),
  );
}

export function sameSection(label: string | null, heading: string | null | undefined): boolean {
  const a = words(label);
  const b = words(heading);

  if (!a.size || !b.size) {
    return false;
  }

  let shared = 0;

  for (const w of a) {
    if (b.has(w)) {
      shared++;
    }
  }

  return shared / Math.min(a.size, b.size) >= 0.5;
}

export function stems(s: string | null | undefined): Set<string> {
  return new Set(
    (s ?? "")
      .toLowerCase()
      .replaceAll(/\([^)]*\)/gu, " ")
      .split(/[^a-z0-9]+/u)
      .filter((w) => w !== "" && !STOP.has(w))
      .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w).slice(0, STEM)),
  );
}

export function headingScore(label: string | null, heading: string | null | undefined) {
  const a = stems(label);
  const b = stems(heading);
  let shared = 0;

  for (const w of a) {
    if (b.has(w)) {
      shared++;
    }
  }

  const enough = shared > 0 && shared >= Math.min(2, a.size) && shared / a.size >= 0.5;

  return { shared, whole: shared === a.size, confident: enough && (a.size > 1 || b.size <= 3) };
}
