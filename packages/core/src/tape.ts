import { z } from "zod";
import type { Section } from "./bundle.ts";

/** A quiet-and-costly run: marks whose neighbours are at most `maxGap` sections apart, at least `minMarks` of them. */
export const QUIET_RUN = { maxGap: 5, minMarks: 3 };

/** Edges in $ millions between the five size classes of a section's dollars: under $100M, $1B, $10B, $100B, over. */
const LEVEL_EDGES = [100, 1_000, 10_000, 100_000];

const ADDS = "12345";
const CUTS = "abcde";

/** 1 to 5: the size class of a dollar amount, by its absolute value. */
export const dollarLevel = (musd: number) => 1 + LEVEL_EDGES.filter((e) => Math.abs(musd) >= e).length;

const dollarChar = (musd: number | null) =>
  musd === null ? "." : musd === 0 ? "0" : (musd > 0 ? ADDS : CUTS)[dollarLevel(musd) - 1]!;

/** The signed size class of a `Tape.dollars` character: 1 to 5 adds, -1 to -5 cuts, 0 for exactly zero, null for no CBO figure. */
export function levelOf(char: string): number | null {
  if (char === ".") return null;
  if (char === "0") return 0;
  const up = ADDS.indexOf(char);
  return up >= 0 ? up + 1 : -(CUTS.indexOf(char) + 1);
}

/** One entry per final section, in bill order, so a bill's tape can be drawn without its bundle. */
export const Tape = z.object({
  /** `l` added late, `.` not; all `.` when the late flag is unavailable for the bill. */
  late: z.string().regex(/^[.l]*$/),
  /**
   * CBO's deficit effect of the section (the figure the score uses), as a size class: `1`-`5` adds, `a`-`e` cuts
   * (under $100M, $1B, $10B, $100B, over), `0` exactly zero, `.` no figure. Classes are the same for every bill.
   */
  dollars: z.string().regex(/^[.0-5a-e]*$/),
  /** Positions whose dollars are an even share of a CBO group line (an inference), not CBO's figure for the section. */
  evenSplit: z.array(z.number().int()),
});

export const QuietRun = z.object({
  /** Positions in the tape, inclusive. */
  from: z.number().int(),
  to: z.number().int(),
  fromNum: z.string(),
  toNum: z.string(),
  marks: z.number().int(),
  /** Marks whose CBO figure adds to the deficit, and whose figure cuts it. */
  added: z.number().int(),
  cut: z.number().int(),
  /** Smallest and largest absolute CBO figure among the marks, in $ millions; null when none has one. */
  minMusd: z.number().nullable(),
  maxMusd: z.number().nullable(),
  /** News articles' mentions of these marks together. */
  hits: z.number().int(),
});

export const QuietCost = z.object({
  /** $ millions the quiet-and-costly sections add to the deficit, and cut from it, by CBO's figure for each section. */
  addedMusd: z.number(),
  cutMusd: z.number(),
  /** How many of those sections have such a figure (the rest qualified through lobbying). */
  measured: z.number().int(),
});

const exactMusd = (s: Section) =>
  s.score?.components.dollarsSplit === "even_split" ? null : (s.score?.components.dollarsMusd ?? null);

/** Everything a landing page draws from a bill without loading it. `final` is the bill's final sections in order. */
export function tapeOf(final: Section[], lateAvailable: boolean) {
  const buried = final.flatMap((s, i) => (s.score?.label === "buried" ? [{ s, i }] : []));
  const measured = buried.flatMap(({ s }) => exactMusd(s) ?? []);
  const hits = (s: Section) => s.attention?.hits ?? 0;
  const ranked = final.some((s) => s.attention);

  const runs: (typeof buried)[] = [];
  for (const mark of buried) {
    const run = runs.at(-1);
    if (run && mark.i - run.at(-1)!.i <= QUIET_RUN.maxGap) run.push(mark);
    else runs.push([mark]);
  }
  const best = runs.reduce<typeof buried | null>(
    (top, r) => (r.length >= QUIET_RUN.minMarks && r.length > (top?.length ?? 0) ? r : top),
    null,
  );
  const figures = best?.flatMap(({ s }) => exactMusd(s) ?? []) ?? [];

  return {
    tape: {
      late: final.map((s) => (lateAvailable && s.late ? "l" : ".")).join(""),
      dollars: final.map((s) => dollarChar(s.score?.components.dollarsMusd ?? null)).join(""),
      evenSplit: final.flatMap((s, i) => (s.score?.components.dollarsSplit === "even_split" ? [i] : [])),
    },
    quietCost: {
      addedMusd: measured.filter((m) => m > 0).reduce((n, m) => n + m, 0),
      cutMusd: measured.filter((m) => m < 0).reduce((n, m) => n - m, 0),
      measured: measured.length,
    },
    mentions: ranked
      ? {
          headline: final.filter((s) => s.score?.label === "headline").reduce((n, s) => n + hits(s), 0),
          total: final.reduce((n, s) => n + hits(s), 0),
        }
      : null,
    quietRun: best
      ? {
          from: best[0]!.i,
          to: best.at(-1)!.i,
          fromNum: best[0]!.s.num,
          toNum: best.at(-1)!.s.num,
          marks: best.length,
          added: figures.filter((m) => m > 0).length,
          cut: figures.filter((m) => m < 0).length,
          minMusd: figures.length ? Math.min(...figures.map(Math.abs)) : null,
          maxMusd: figures.length ? Math.max(...figures.map(Math.abs)) : null,
          hits: best.reduce((n, { s }) => n + hits(s), 0),
        }
      : null,
  };
}
