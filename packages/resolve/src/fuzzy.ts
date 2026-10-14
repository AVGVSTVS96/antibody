/**
 * The rapidfuzz scorers the spike measured with (0..100), reimplemented on the Indel distance:
 * ratio = 100 · (1 − indel / (|a| + |b|)), where indel = |a| + |b| − 2·LCS.
 */
export function ratio(a: string, b: string): number {
  if (!a.length && !b.length) return 100;
  if (!a.length || !b.length) return 0;
  return (200 * lcs(a, b)) / (a.length + b.length);
}

function lcs(a: string, b: string): number {
  const prev = new Uint16Array(b.length + 1);
  const cur = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++)
      cur[j] = ca === b.charCodeAt(j - 1) ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!);
    prev.set(cur);
  }
  return prev[b.length]!;
}

const split = (s: string) => s.split(" ").filter(Boolean);

export const tokenSort = (a: string, b: string) => ratio(split(a).sort().join(" "), split(b).sort().join(" "));

export function tokenSet(a: string, b: string): number {
  const ta = new Set(split(a));
  const tb = new Set(split(b));
  const both = [...ta].filter((t) => tb.has(t)).sort();
  const onlyA = [...ta].filter((t) => !tb.has(t)).sort();
  const onlyB = [...tb].filter((t) => !ta.has(t)).sort();
  if (both.length && (!onlyA.length || !onlyB.length)) return 100;
  const sect = both.join(" ");
  const withA = [sect, ...onlyA].filter(Boolean).join(" ");
  const withB = [sect, ...onlyB].filter(Boolean).join(" ");
  return Math.max(ratio(sect, withA), ratio(sect, withB), ratio(withA, withB));
}

function edits(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

/** Same words in the same order, each at most two typos apart and starting with the same letter ("sherwin williams" ~ "sherwin william"). */
export function typoClose(a: string, b: string): boolean {
  const ta = split(a);
  const tb = split(b);
  return ta.length === tb.length && ta.every((t, i) => t[0] === tb[i]![0] && edits(t, tb[i]!) <= 2);
}
