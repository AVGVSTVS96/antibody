import { canon } from "./text.ts";

/**
 * Python difflib's SequenceMatcher over word arrays (no junk function), so word counts match the Phase 0 spike.
 * `autojunk` drops words that fill more than 1% of a long `b` from match seeding, as difflib does.
 */
function matchingBlocks(a: string[], b: string[], autojunk: boolean): [number, number, number][] {
  const b2j = new Map<string, number[]>();
  b.forEach((w, j) => {
    const list = b2j.get(w);
    if (list) list.push(j);
    else b2j.set(w, [j]);
  });
  if (autojunk && b.length >= 200) {
    const ntest = Math.floor(b.length / 100) + 1;
    for (const [w, idx] of b2j) if (idx.length > ntest) b2j.delete(w);
  }

  const longest = (alo: number, ahi: number, blo: number, bhi: number): [number, number, number] => {
    let [bi, bj, size] = [alo, blo, 0];
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const next = new Map<number, number>();
      for (const j of b2j.get(a[i]!) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        next.set(j, k);
        if (k > size) [bi, bj, size] = [i - k + 1, j - k + 1, k];
      }
      j2len = next;
    }
    while (bi > alo && bj > blo && a[bi - 1] === b[bj - 1]) [bi, bj, size] = [bi - 1, bj - 1, size + 1];
    while (bi + size < ahi && bj + size < bhi && a[bi + size] === b[bj + size]) size++;
    return [bi, bj, size];
  };

  const blocks: [number, number, number][] = [];
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const [i, j, k] = longest(alo, ahi, blo, bhi);
    if (!k) continue;
    blocks.push([i, j, k]);
    if (alo < i && blo < j) queue.push([alo, i, blo, j]);
    if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
  }
  blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const merged: [number, number, number][] = [];
  for (const [i, j, k] of blocks) {
    const last = merged.at(-1);
    if (last && last[0] + last[2] === i && last[1] + last[2] === j) last[2] += k;
    else merged.push([i, j, k]);
  }
  merged.push([a.length, b.length, 0]);
  return merged;
}

export interface WordDiff {
  wordsAdded: number;
  wordsRemoved: number;
  largestInserts: string[];
}

export function wordDiff(before: string, after: string, cap = 4000): WordDiff {
  const a = canon(before).split(" ").filter(Boolean);
  const b = canon(after).split(" ").filter(Boolean);
  let [added, removed, i, j] = [0, 0, 0, 0];
  const inserts: string[] = [];
  for (const [ai, bj, size] of matchingBlocks(a, b, a.length > cap || b.length > cap)) {
    removed += ai - i;
    if (bj > j) {
      added += bj - j;
      inserts.push(b.slice(j, bj).join(" "));
    }
    [i, j] = [ai + size, bj + size];
  }
  inserts.sort((x, y) => y.length - x.length);
  return { wordsAdded: added, wordsRemoved: removed, largestInserts: inserts.slice(0, 3).map((s) => s.slice(0, 240)) };
}
