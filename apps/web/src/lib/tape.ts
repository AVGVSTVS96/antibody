import { inBillOrder } from "@antibody/core";
import { capital, count } from "./format.ts";
import type { BillModel, SectionView } from "./model.ts";

export type TapeKind = "headline" | "quiet" | "other";

/** What the tape draws and says about a section; the bundle's model adds `view`, the index's featured block does not. */
export interface TapeMark {
  index: number;
  id: string;
  /** The section's number when no other section of the bill has it, else its full id. Not URL-encoded. */
  routeId: string;
  num: string;
  /** `§30002`, with the version in brackets when another section of the bill has the same number. */
  label: string;
  heading: string;
  /** Headline, quiet and costly (the model's `buried` label) or the rest: the bundle's own score, no new thresholds. */
  kind: TapeKind;
  /** Signed CBO deficit effect in $ millions (positive adds, negative cuts); null when CBO lists no figure for it. */
  musd: number | null;
  /** The figure is a CBO group line divided evenly over its sections: an inference. */
  evenSplit: boolean;
  /** Added after a chamber passed the bill; always false when the bill's late flag is unavailable. */
  late: boolean;
  /** Key of the `TapeGroup` it sits in, null for front matter outside any title or division. */
  group: string | null;
  /** Where it sits in the law, outermost first: ["Title VII", "Subtitle A", "Chapter 3"]. */
  place: string[];
  /** News articles that match the section; null when coverage was not measured for it. */
  articles: number | null;
  /** Lobbying filings that name the section. */
  lobbying: number;
}

export interface TapeRow extends TapeMark {
  view: SectionView;
}

export interface TapeGroup {
  key: string;
  /** "Title VII", "Division A". */
  label: string;
  /** "VII", "A". */
  short: string;
  from: number;
  to: number;
  count: number;
  quiet: number;
}

export interface Tape<R extends TapeMark = TapeRow> {
  rows: R[];
  groups: TapeGroup[];
  /** No section has its own CBO figure, so height cannot show cost and carries the section's kind instead. */
  flat: boolean;
  /** False when the bill began as a shell or was rewritten wholesale, so "added late" cannot be told. */
  lateKnown: boolean;
  lateReason: string | null;
  /** Articles read for the bill: the sample the per-section counts come from. */
  read: number;
  headline: number;
  quiet: number;
  noFigure: number;
  evenSplit: number;
}

const KIND: Record<SectionView["kind"], TapeKind> = {
  headline: "headline",
  buried: "quiet",
  normal: "other",
  unscored: "other",
};

export function placeOf(path: string) {
  const segs = path.split("/").map((p) => p.split(":") as [string, string]);
  const [kind, value] = segs[0]!;
  return {
    place: segs.filter(([k]) => k !== "sec").map(([k, v]) => `${capital(k)} ${v}`),
    group: kind === "sec" ? null : `${kind}:${value}`,
  };
}

/** The tape around rows already in bill order: the title or division groups they fall in, and the counts the legend and notes read. */
export function assemble<R extends TapeMark>(
  rows: R[],
  { lateKnown, lateReason, read }: Pick<Tape, "lateKnown" | "lateReason" | "read">,
): Tape<R> {
  const groups: TapeGroup[] = [];
  for (const r of rows) {
    if (!r.group) continue;
    const last = groups.at(-1);
    if (last?.key === r.group) {
      last.to = r.index;
      last.count++;
      if (r.kind === "quiet") last.quiet++;
    } else {
      const [kind, value] = r.group.split(":") as [string, string];
      groups.push({
        key: r.group,
        label: `${capital(kind)} ${value}`,
        short: value,
        from: r.index,
        to: r.index,
        count: 1,
        quiet: r.kind === "quiet" ? 1 : 0,
      });
    }
  }
  return {
    rows,
    groups,
    flat: rows.every((r) => r.musd == null),
    lateKnown,
    lateReason,
    read,
    headline: rows.filter((r) => r.kind === "headline").length,
    quiet: rows.filter((r) => r.kind === "quiet").length,
    noFigure: rows.filter((r) => r.musd == null).length,
    evenSplit: rows.filter((r) => r.evenSplit).length,
  };
}

export function buildTape(m: BillModel): Tape {
  const lateKnown = !m.b.bill.lateUnavailable;
  const rows = inBillOrder(m.sections.filter((v) => v.s.inFinal).map((v) => ({ path: v.s.path, v }))).map(
    ({ v }, index): TapeRow => ({
      index,
      view: v,
      id: v.s.id,
      routeId: m.sectionSlug(v),
      num: v.s.num,
      label: m.secLabel(v),
      heading: v.s.heading,
      kind: KIND[v.kind],
      musd: v.dollarsMusd,
      evenSplit: v.figure?.split === "even_split",
      late: lateKnown && v.s.late,
      ...placeOf(v.s.path),
      articles: v.s.attention?.hits ?? null,
      lobbying: v.named,
    }),
  );
  return assemble(rows, {
    lateKnown,
    lateReason: m.b.bill.lateUnavailable,
    read: m.b.attention.sample?.relevant ?? m.b.attention.articles,
  });
}

/** The log scale tops out near $4T: the largest bill-level figures stay on it, and every bill shares the one key. */
export const LOG_MAX = 6.6;
const MIN_MUSD = 10;

/** A power-of-ten figure as both scales label it: "$10M", "$1B", "$10T". */
export const scaleLabel = (musd: number) =>
  musd >= 1e6 ? `$${musd / 1e6}T` : musd >= 1e3 ? `$${musd / 1e3}B` : `$${musd}M`;

export const REFERENCES = [1e3, 1e5, 1e6].map((musd) => ({ musd, label: scaleLabel(musd) }));

export interface Geometry {
  height: number;
  /** Baseline: bars for adds rise from it, cuts hang from it. */
  mid: number;
  /** Height of a $4T bar. */
  maxh: number;
  lateY: number;
  lateH: number;
  flat: boolean;
}

/** `marked` is false for a flat tape with only plain marks, which then needs no room above them for taller ones. */
export function geometry(compact: boolean, flat: boolean, marked = true): Geometry {
  const [pad, maxh, gap] = compact ? [4, 34, 12] : [6, 60, 18];
  const lateH = 6;
  const span = flat ? (marked ? maxh * 2 : Math.round((maxh * 2) / 3)) : maxh;
  const mid = pad + span;
  const lateY = mid + (flat ? 0 : maxh) + gap;
  return { height: lateY + lateH, mid, maxh, lateY, lateH, flat };
}

export const logHeight = (musd: number, g: Geometry) =>
  Math.max(2, Math.round((g.maxh * Math.log10(Math.max(Math.abs(musd), MIN_MUSD))) / LOG_MAX));

export interface Mark {
  x: number;
  w: number;
  y: number;
  h: number;
  /** Stands for "no CBO figure": a thin outlined stub on the baseline, not a bar. */
  stub: boolean;
}

const GAP = 1;
const MAX_W = 32;

export const slot = (width: number, n: number) => width / Math.max(n, 1);

/** Where each row's mark sits in a tape `width` px wide, by the designer's rule: pitch `width / n`, 1px gap, 2px floor. */
export function layout(tape: Tape<TapeMark>, width: number, g: Geometry): Mark[] {
  const bw = slot(width, tape.rows.length);
  const w = Math.min(MAX_W, Math.max(Math.round(bw - GAP), 2));
  const inset = bw - GAP > MAX_W ? (bw - MAX_W) / 2 : 0;
  return tape.rows.map((r, i) => {
    const x = Math.round(i * bw + inset);
    if (g.flat) {
      const h = r.kind === "other" ? Math.round((g.maxh * 2) / 3) : g.maxh * 2;
      return { x, w, y: g.mid - h, h, stub: false };
    }
    if (r.musd == null) return { x, w, y: g.mid - 1, h: 2, stub: true };
    const h = logHeight(r.musd, g);
    return { x, w, y: r.musd < 0 ? g.mid : g.mid - h, h, stub: false };
  });
}

/** The row under a pointer `x` px from the tape's left edge. */
export const indexAt = (x: number, width: number, n: number) =>
  Math.min(n - 1, Math.max(0, Math.floor(x / slot(width, n))));

export interface TapeRun<R extends TapeMark = TapeRow> {
  from: number;
  to: number;
  rows: R[];
}

/**
 * The densest stretch of quiet and costly marks: it starts and ends on one and at least half of its sections are
 * quiet, with at least three of them. Null when the bill has no such stretch.
 */
export function quietRun<R extends TapeMark>(tape: Tape<R>): TapeRun<R> | null {
  const at = tape.rows.filter((r) => r.kind === "quiet").map((r) => r.index);
  let best: [number, number] | null = null;
  for (let i = 0; i < at.length; i++)
    for (let j = i + 2; j < at.length; j++) {
      const n = j - i + 1;
      if (2 * n >= at[j]! - at[i]! + 1 && (!best || n > best[1] - best[0] + 1)) best = [i, j];
    }
  if (!best) return null;
  const from = at[best[0]]!;
  const to = at[best[1]]!;
  return { from, to, rows: tape.rows.slice(from, to + 1).filter((r) => r.kind === "quiet") };
}

/** Signed CBO millions as a short figure with one decimal: "$29.7B", the way the designs print a range. */
const short = (m: number) => {
  const a = Math.abs(m);
  return a < 1e3 ? `$${Math.round(a)}M` : a < 1e6 ? `$${(a / 1e3).toFixed(1)}B` : `$${(a / 1e6).toFixed(2)}T`;
};

const WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

/** "Eight quiet and costly marks in one run: 5 add, 3 cut, $6.6B to $29.7B each, none in the 287 articles read." */
export function runNote(run: TapeRun<TapeMark>, tape: Tape<TapeMark>): string {
  const n = run.rows.length;
  const figured = run.rows.filter((r) => r.musd != null);
  const abs = figured.map((r) => Math.abs(r.musd!));
  const adds = figured.filter((r) => r.musd! > 0).length;
  const cuts = figured.filter((r) => r.musd! < 0).length;
  const lo = Math.min(...abs);
  const hi = Math.max(...abs);
  const parts: string[] = [];
  if (figured.length) {
    parts.push(
      [adds && `${adds} add`, cuts && `${cuts} cut`].filter(Boolean).join(", "),
      lo === hi ? `${short(hi)} each` : `${short(lo)} to ${short(hi)} each`,
    );
  }
  const unfigured = n - figured.length;
  if (unfigured) parts.push(`${unfigured} with no CBO figure`);
  const even = run.rows.filter((r) => r.evenSplit).length;
  if (even) parts.push(`${even} of the figures an even split (inference)`);
  const measured = run.rows.filter((r) => r.articles != null);
  const hits = measured.reduce((a, r) => a + r.articles!, 0);
  if (measured.length === n)
    parts.push(
      hits
        ? `${count(hits, "article match", "article matches")} in the ${count(tape.read, "article")} read`
        : `none in the ${count(tape.read, "article")} read`,
    );
  else parts.push(`coverage not measured for ${count(n - measured.length, "of them")}`);
  const lead = n < WORDS.length ? capital(WORDS[n]!) : n.toLocaleString("en-US");
  return `${lead} yellow marks in one run: ${parts.join(", ")}.`;
}
