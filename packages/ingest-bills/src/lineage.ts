import { wordDiff } from "./diff.ts";
import { containedIn, type Method, match } from "./match.ts";
import type { Sec } from "./sections.ts";

export interface ParsedVersion {
  code: string;
  secs: Sec[];
  /** A predecessor bill's text shown as an earlier stage (S.394 before S.1582). */
  predecessor: boolean;
}

export interface Step {
  path: string;
  heading: string;
  hash: string;
  words: number;
  match: Method | "revived" | null;
  similarity: number | null;
  wordsAdded: number | null;
  wordsRemoved: number | null;
  largestInserts: string[];
  movedFrom: string | null;
}

export interface Lineage {
  /** `<billId>@<first version>:<path>` */
  id: string;
  firstVersion: string;
  changedIn: string[];
  /** The version where this lineage ends. When `splitInto` is non-empty it was split there, not dropped. */
  removedIn: string | null;
  revivedIn: string[];
  splitFrom: { id: string; share: number } | null;
  splitInto: string[];
  mergedInto: { id: string; share: number } | null;
  history: Record<string, Step>;
  /** The section as last seen. */
  last: Sec;
  lastVersion: string;
}

export interface StepStats {
  from: string;
  to: string;
  oldSections: number;
  newSections: number;
  matched: Partial<Record<Method, number>>;
  added: number;
  addedSplitFromOld: number;
  revived: number;
  removed: number;
  removedMergedIntoNew: number;
}

/** Tracks every section across the versions, oldest first. */
export function trace(bill: string, versions: ParsedVersion[]): { lineages: Lineage[]; steps: StepStats[] } {
  const lineages: Lineage[] = [];
  const steps: StepStats[] = [];
  let current = new Map<number, number>();

  versions.forEach((v, vi) => {
    const secs = v.secs;
    const prev = vi ? versions[vi - 1]!.secs : [];
    const pairs = vi ? match(prev, secs) : new Map();
    const leftovers = secs.map((_, j) => j).filter((j) => !pairs.has(j));

    const dormant = lineages.flatMap((l, k) => (l.removedIn ? [k] : []));
    const revived = new Map<number, { lineage: number; score: number }>();
    if (dormant.length && leftovers.length) {
      const back = match(
        dormant.map((k) => lineages[k]!.last),
        leftovers.map((j) => secs[j]!),
        { fuzzyFloor: 0.6, headingFloor: 1.1, rewriteFloor: 1.1, citeFloor: 1.1 },
      );
      for (const [jj, p] of back) revived.set(leftovers[jj]!, { lineage: dormant[p.old]!, score: p.score });
    }

    const fresh = leftovers.filter((j) => !revived.has(j));
    const split = new Map(
      [
        ...containedIn(
          fresh.map((j) => secs[j]!),
          prev,
        ),
      ].map(([k, hit]) => [fresh[k]!, hit]),
    );
    const usedPrev = new Set([...pairs.values()].map((p) => p.old));
    const gone = prev.map((_, i) => i).filter((i) => !usedPrev.has(i));
    const merged = new Map(
      [
        ...containedIn(
          gone.map((i) => prev[i]!),
          secs,
        ),
      ].map(([k, hit]) => [gone[k]!, hit]),
    );

    const next = new Map<number, number>();
    secs.forEach((s, j) => {
      const step: Step = {
        path: s.path,
        heading: s.heading,
        hash: s.hash,
        words: s.words,
        match: null,
        similarity: null,
        wordsAdded: null,
        wordsRemoved: null,
        largestInserts: [],
        movedFrom: null,
      };
      let idx: number;
      const pair = pairs.get(j);
      const back = revived.get(j);
      if (pair) {
        idx = current.get(pair.old)!;
        const before = prev[pair.old]!;
        Object.assign(step, { match: pair.method, similarity: pair.score });
        if (s.hash !== before.hash) {
          lineages[idx]!.changedIn.push(v.code);
          Object.assign(step, wordDiff(before.text, s.text));
        }
        if (s.path !== before.path) step.movedFrom = before.path;
      } else if (back) {
        idx = back.lineage;
        const l = lineages[idx]!;
        l.removedIn = null;
        l.revivedIn.push(v.code);
        Object.assign(step, { match: "revived", similarity: back.score });
        if (s.hash !== l.last.hash) Object.assign(step, wordDiff(l.last.text, s.text));
      } else {
        idx = lineages.length;
        const from = split.get(j);
        const parent = from ? lineages[current.get(from.whole)!]! : null;
        const id = `${bill}@${v.code}:${s.path}`;
        lineages.push({
          id,
          firstVersion: v.code,
          changedIn: [],
          removedIn: null,
          revivedIn: [],
          splitFrom: parent && from ? { id: parent.id, share: from.share } : null,
          splitInto: [],
          mergedInto: null,
          history: {},
          last: s,
          lastVersion: v.code,
        });
        parent?.splitInto.push(id);
      }
      const l = lineages[idx]!;
      l.history[v.code] = step;
      l.last = s;
      l.lastVersion = v.code;
      next.set(j, idx);
    });

    const alive = new Set(next.values());
    for (const idx of new Set(current.values())) if (!alive.has(idx)) lineages[idx]!.removedIn = v.code;
    for (const [i, hit] of merged)
      lineages[current.get(i)!]!.mergedInto = { id: lineages[next.get(hit.whole)!]!.id, share: hit.share };

    if (vi) {
      const matched: Partial<Record<Method, number>> = {};
      for (const p of pairs.values()) matched[p.method as Method] = (matched[p.method as Method] ?? 0) + 1;
      steps.push({
        from: versions[vi - 1]!.code,
        to: v.code,
        oldSections: prev.length,
        newSections: secs.length,
        matched,
        added: fresh.length,
        addedSplitFromOld: split.size,
        revived: revived.size,
        removed: gone.length,
        removedMergedIntoNew: merged.size,
      });
    }
    current = next;
  });

  for (const l of lineages) if (!l.removedIn) l.mergedInto = null;
  return { lineages, steps };
}

/**
 * A bill whose text was replaced wholesale gets no late flags: they would mark nearly every section and say nothing
 * about any one. Two cases, one rule for every bill and party: it began as a shell (its first own text is under a
 * tenth of the final words), or 80% or more of its final sections would be flagged late.
 */
export const WHOLESALE = { shellShare: 0.1, lateShare: 0.8 };

export function wholesaleReason(lineages: Lineage[], versions: ParsedVersion[]): string | null {
  const words = (v?: ParsedVersion) => v?.secs.reduce((n, s) => n + s.words, 0) ?? 0;
  const own = versions.filter((v) => !v.predecessor);
  const first = own[0];
  const finalWords = words(own.at(-1));
  if (first && finalWords && words(first) < WHOLESALE.shellShare * finalWords)
    return `The bill began as a short shell (${words(first).toLocaleString("en-US")} words, against ${finalWords.toLocaleString("en-US")} in the final text), so its real text arrived late as a whole and "added late" says nothing about any one section.`;
  const final = lineages.filter((l) => !l.removedIn);
  const late = final.filter((l) => isLate(l, versions)).length;
  if (final.length && late / final.length >= WHOLESALE.lateShare)
    return `${Math.round((100 * late) / final.length)}% of the final sections first appear after a chamber had passed the bill (its text was rewritten wholesale), so "added late" says nothing about any one section.`;
  return null;
}

const PASSED = new Set(["eh", "es", "ath", "ats", "eah", "eas", "enr", "plaw"]);

/** A split keeping at least this share of its parent's wording is a move, not new text. */
export const PURE_SPLIT = 0.9;

/**
 * Late: first appears in the first chamber-passed text or after it (floor amendments, the other chamber, conference),
 * and isn't just a piece split out of an older section. Sections of the bill's first own text are never late.
 */
export function isLate(l: Lineage, versions: ParsedVersion[]): boolean {
  const codes = versions.map((v) => v.code);
  const first = codes.indexOf(l.firstVersion);
  const ownStart = versions.findIndex((v) => !v.predecessor);
  const passed = codes.findIndex((c) => PASSED.has(c));
  if (passed < 0 || first <= ownStart || first < passed) return false;
  return !(l.splitFrom && l.splitFrom.share >= PURE_SPLIT);
}
