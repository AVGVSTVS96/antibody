import type { Sec } from "./sections.ts";
import { canon, headingWords, intersect, normHeading } from "./text.ts";

export type Method = "identical" | "xml-id" | "fuzzy" | "heading" | "rewritten" | "same-law";
export interface Pair {
  old: number;
  method: Method;
  score: number;
}

export interface MatchOptions {
  headingFloor: number;
  fuzzyFloor: number;
  rewriteFloor: number;
  /** Share of cited provisions two sections must have in common for a same-law match (above 1 turns the pass off). */
  citeFloor: number;
  /**
   * A same-law match also needs this much text in common. Two sections can amend the same law and be unrelated:
   * IRA "Large scale water reuse" and the Senate's $4B "Drought mitigation" share a cite at similarity 0.096.
   */
  sameLawSimilarity: number;
}

export const DEFAULTS: MatchOptions = {
  headingFloor: 0.15,
  fuzzyFloor: 0.45,
  rewriteFloor: 0.45,
  citeFloor: 0.5,
  sameLawSimilarity: 0.15,
};

/** Shingles found in more than `maxDf` sections are effective-date and conforming boilerplate; they say nothing about identity. */
function cores(secs: Sec[], maxDf = 6): Map<Sec, Set<string>> {
  const df = new Map<string, number>();
  for (const s of secs) for (const h of s.sh) df.set(h, (df.get(h) ?? 0) + 1);
  return new Map(secs.map((s) => [s, new Set([...s.sh].filter((h) => df.get(h)! <= maxDf))]));
}

export function similarity(a: Sec, b: Sec, core?: Map<Sec, Set<string>>): number {
  const sa = core?.get(a) ?? a.sh;
  const sb = core?.get(b) ?? b.sh;
  if (!sa.size || !sb.size) return canon(a.text) === canon(b.text) ? 1 : 0;
  const inter = intersect(sa, sb);
  return (inter / Math.min(sa.size, sb.size)) * 0.5 + (inter / (sa.size + sb.size - inter)) * 0.5;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

const round = (x: number) => Math.round(x * 1000) / 1000;
const byScore = (x: [number, number, number], y: [number, number, number]) => y[0] - x[0] || y[1] - x[1] || y[2] - x[2];

function topCounts(keys: Iterable<number>, n: number): [number, number][] {
  const counts = new Map<number, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, n);
}

/**
 * One-to-one match of each new section to an old one, in passes from strongest to weakest evidence:
 * identical text, same XML id, shared 5-word runs, same heading, rewritten (heading words + kept text), same law.
 * Returns new index → pair.
 */
export function match(old: Sec[], next: Sec[], options: Partial<MatchOptions> = {}): Map<number, Pair> {
  const o = { ...DEFAULTS, ...options };
  const pairs = new Map<number, Pair>();
  const usedOld = new Set<number>();
  const core = cores([...old, ...next]);
  const words = new Map([...old, ...next].map((s) => [s, headingWords(s.heading)]));
  const heads = new Map([...old, ...next].map((s) => [s, normHeading(s.heading)]));
  const sim = (i: number, j: number) => similarity(old[i]!, next[j]!, core);
  const take = (i: number, j: number, method: Method, score: number) => {
    pairs.set(j, { old: i, method, score: round(score) });
    usedOld.add(i);
  };

  const byHash = new Map<string, number[]>();
  for (const [i, s] of old.entries()) push(byHash, s.hash, i);
  next.forEach((s, j) => {
    const i = byHash.get(s.hash)?.find((i) => !usedOld.has(i));
    if (i !== undefined) take(i, j, "identical", 1);
  });

  const byId = new Map(old.flatMap((s, i) => (s.xmlId ? [[s.xmlId, i] as const] : [])));
  next.forEach((s, j) => {
    const i = s.xmlId ? byId.get(s.xmlId) : undefined;
    if (!pairs.has(j) && i !== undefined && !usedOld.has(i)) take(i, j, "xml-id", sim(i, j));
  });

  const index = new Map<string, number[]>();
  old.forEach((s, i) => {
    if (!usedOld.has(i)) for (const h of s.sh) push(index, h, i);
  });
  let scored: [number, number, number][] = [];
  next.forEach((s, j) => {
    if (pairs.has(j)) return;
    const hits = function* () {
      for (const h of s.sh) for (const i of index.get(h) ?? []) if (!usedOld.has(i)) yield i;
    };
    for (const [i] of topCounts(hits(), 8)) scored.push([sim(i, j), i, j]);
    const heading = heads.get(s);
    old.forEach((os, i) => {
      if (!usedOld.has(i) && os.heading && heads.get(os) === heading)
        scored.push([Math.max(sim(i, j), o.headingFloor) + 0.3, i, j]);
    });
  });
  for (const [, i, j] of scored.sort(byScore)) {
    if (pairs.has(j) || usedOld.has(i)) continue;
    const sameHeading = heads.get(old[i]!) === heads.get(next[j]!);
    const s = sim(i, j);
    if (s < 0.7 && !intersect(words.get(old[i]!)!, words.get(next[j]!)!)) continue;
    if (s >= o.fuzzyFloor || (sameHeading && s >= o.headingFloor))
      take(i, j, sameHeading && s < o.fuzzyFloor ? "heading" : "fuzzy", s);
  }

  scored = [];
  next.forEach((s, j) => {
    if (pairs.has(j)) return;
    const hs = words.get(s)!;
    const cs = core.get(s)!;
    old.forEach((os, i) => {
      if (usedOld.has(i)) return;
      const ho = words.get(os)!;
      const shared = intersect(ho, hs);
      const hj = ho.size && hs.size ? shared / (ho.size + hs.size - shared) : 0;
      const co = core.get(os)!;
      const kept = co.size && cs.size ? intersect(co, cs) / Math.min(co.size, cs.size) : 0;
      if ((hj >= 0.3 && kept >= 0.2) || hj >= 0.6) scored.push([hj * 0.5 + kept * 0.5, i, j]);
    });
  });
  for (const [score, i, j] of scored.sort(byScore))
    if (!pairs.has(j) && !usedOld.has(i) && score >= o.rewriteFloor) take(i, j, "rewritten", sim(i, j));

  if (o.citeFloor <= 1) {
    const df = new Map<string, number>();
    for (const s of [...old, ...next]) for (const c of s.cites) df.set(c, (df.get(c) ?? 0) + 1);
    scored = [];
    next.forEach((s, j) => {
      if (pairs.has(j) || !s.cites.size) return;
      old.forEach((os, i) => {
        if (usedOld.has(i) || !os.cites.size) return;
        const shared = [...os.cites].filter((c) => s.cites.has(c));
        if (!shared.length || Math.min(...shared.map((c) => df.get(c)!)) > 4) return;
        scored.push([shared.length / (os.cites.size + s.cites.size - shared.length), i, j]);
      });
    });
    for (const [score, i, j] of scored.sort(byScore))
      if (!pairs.has(j) && !usedOld.has(i) && score >= o.citeFloor && sim(i, j) >= o.sameLawSimilarity)
        take(i, j, "same-law", sim(i, j));
  }
  return pairs;
}

/** For each part, the whole holding the largest share of its 5-word runs, when that share is at least `floor`. */
export function containedIn(parts: Sec[], wholes: Sec[], floor = 0.5): Map<number, { whole: number; share: number }> {
  const index = new Map<string, number[]>();
  wholes.forEach((s, w) => {
    for (const h of s.sh) push(index, h, w);
  });
  const out = new Map<number, { whole: number; share: number }>();
  parts.forEach((s, p) => {
    if (s.sh.size < 5) return;
    const hits = function* () {
      for (const h of s.sh) yield* new Set(index.get(h) ?? []);
    };
    const [top] = topCounts(hits(), 1);
    if (top && top[1] / s.sh.size >= floor) out.set(p, { whole: top[0], share: round(top[1] / s.sh.size) });
  });
  return out;
}
