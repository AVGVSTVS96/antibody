import { must } from "@antibody/core";
import { wordDiff } from "./diff.ts";
import { containedIn, match } from "./match.ts";
import type { Method, Pair } from "./match.ts";
import type { Sec } from "./sections.ts";

export interface ParsedVersion {
  code: string;
  secs: Sec[];
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

export type StepRef = Pick<Step, "path" | "hash">;

export const isStepRef = (value: unknown): value is StepRef =>
  typeof value === "object" &&
  value !== null &&
  "path" in value &&
  "hash" in value &&
  typeof value.path === "string" &&
  typeof value.hash === "string";

export interface Lineage {
  id: string;
  firstVersion: string;
  changedIn: string[];
  removedIn: string | null;
  revivedIn: string[];
  splitFrom: { id: string; share: number } | null;
  splitInto: string[];
  mergedInto: { id: string; share: number } | null;
  history: Record<string, Step>;
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

export function trace(bill: string, versions: ParsedVersion[]) {
  const lineages: Lineage[] = [];
  const taken = new Set<string>();
  const steps: StepStats[] = [];
  let current = new Map<number, number>();
  const lineageAt = (idx: number | undefined) => must(lineages[must(idx, "a lineage index")], "a traced lineage");

  versions.forEach((v, vi) => {
    const secs = v.secs;
    const prev = versions[vi - 1]?.secs ?? [];
    const pairs = vi ? match(prev, secs) : new Map<number, Pair>();
    const leftovers = secs.map((_, j) => j).filter((j) => !pairs.has(j));
    const secAt = (j: number) => must(secs[j], `section ${j} of ${v.code}`);
    const prevAt = (i: number) => must(prev[i], `section ${i} before ${v.code}`);

    const dormant = lineages.flatMap((l, k) => (l.removedIn !== null && l.removedIn !== "" ? [k] : []));
    const revived = new Map<number, { lineage: number; score: number }>();

    if (dormant.length && leftovers.length) {
      const back = match(
        dormant.map((k) => lineageAt(k).last),
        leftovers.map((j) => secAt(j)),
        { fuzzyFloor: 0.6, headingFloor: 1.1, rewriteFloor: 1.1, citeFloor: 1.1 },
      );

      for (const [jj, p] of back) {
        revived.set(must(leftovers[jj], "a revived section"), {
          lineage: must(dormant[p.old], "a dormant lineage"),
          score: p.score,
        });
      }
    }

    const fresh = leftovers.filter((j) => !revived.has(j));

    const split = new Map(
      [
        ...containedIn(
          fresh.map((j) => secAt(j)),
          prev,
        ),
      ].map(([k, hit]) => [must(fresh[k], "a split section"), hit]),
    );

    const usedPrev = new Set([...pairs.values()].map((p) => p.old));
    const gone = prev.map((_, i) => i).filter((i) => !usedPrev.has(i));

    const merged = new Map(
      [
        ...containedIn(
          gone.map((i) => prevAt(i)),
          secs,
        ),
      ].map(([k, hit]) => [must(gone[k], "a merged section"), hit]),
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
        idx = must(current.get(pair.old), "the lineage of a matched section");
        const before = prevAt(pair.old);
        Object.assign(step, { match: pair.method, similarity: pair.score });

        if (s.hash !== before.hash) {
          lineageAt(idx).changedIn.push(v.code);
          Object.assign(step, wordDiff(before.text, s.text));
        }

        if (s.path !== before.path) {
          step.movedFrom = before.path;
        }
      } else if (back) {
        idx = back.lineage;
        const l = lineageAt(idx);
        l.removedIn = null;
        l.revivedIn.push(v.code);
        Object.assign(step, { match: "revived", similarity: back.score });

        if (s.hash !== l.last.hash) {
          Object.assign(step, wordDiff(l.last.text, s.text));
        }
      } else {
        idx = lineages.length;
        const from = split.get(j);
        const parent = from ? lineageAt(current.get(from.whole)) : null;
        const base = `${bill}@${v.code}:${s.path}`;
        let id = base;

        for (let n = 2; taken.has(id); n++) {
          id = `${base}~${n}`;
        }

        taken.add(id);
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

      const l = lineageAt(idx);
      l.history[v.code] = step;
      l.last = s;
      l.lastVersion = v.code;
      next.set(j, idx);
    });

    const alive = new Set(next.values());

    for (const idx of new Set(current.values())) {
      if (!alive.has(idx)) {
        lineageAt(idx).removedIn = v.code;
      }
    }

    for (const [i, hit] of merged) {
      lineageAt(current.get(i)).mergedInto = { id: lineageAt(next.get(hit.whole)).id, share: hit.share };
    }

    if (vi) {
      const matched: Partial<Record<Method, number>> = {};

      for (const p of pairs.values()) {
        matched[p.method] = (matched[p.method] ?? 0) + 1;
      }

      steps.push({
        from: must(versions[vi - 1], "the previous version").code,
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

  for (const l of lineages) {
    if (l.removedIn === null || l.removedIn === "") {
      l.mergedInto = null;
    }
  }

  return { lineages, steps };
}

export const WHOLESALE = { shellShare: 0.1, lateShare: 0.8 };

export function wholesaleReason(lineages: Lineage[], versions: ParsedVersion[]): string | null {
  const words = (v?: ParsedVersion) => v?.secs.reduce((n, s) => n + s.words, 0) ?? 0;
  const own = versions.filter((v) => !v.predecessor);
  const first = own[0];
  const finalWords = words(own.at(-1));

  if (first && finalWords && words(first) < WHOLESALE.shellShare * finalWords) {
    return `The bill began as a short shell (${words(first).toLocaleString("en-US")} words, against ${finalWords.toLocaleString("en-US")} in the final text), so its real text arrived late as a whole and "added late" says nothing about any one section.`;
  }

  const final = lineages.filter((l) => l.removedIn === null || l.removedIn === "");
  const late = final.filter((l) => isLate(l, versions)).length;

  if (final.length && late / final.length >= WHOLESALE.lateShare) {
    return `${Math.round((100 * late) / final.length)}% of the final sections first appear after a chamber had passed the bill (its text was rewritten wholesale), so "added late" says nothing about any one section.`;
  }

  return null;
}

export const PASSED = new Set(["eh", "es", "ath", "ats", "eah", "eas", "enr", "plaw"]);

export const PURE_SPLIT = 0.9;

export function isLate(l: Lineage, versions: ParsedVersion[]): boolean {
  const codes = versions.map((v) => v.code);
  const first = codes.indexOf(l.firstVersion);
  const ownStart = versions.findIndex((v) => !v.predecessor);
  const passed = codes.findIndex((c) => PASSED.has(c));

  if (passed === -1 || first <= ownStart || first < passed) {
    return false;
  }

  return !(l.splitFrom && l.splitFrom.share >= PURE_SPLIT);
}
