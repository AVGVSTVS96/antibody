import { STEPS, type Step, type Tally } from "./events.ts";

/**
 * The numbers a bill is ranked on. Nothing here knows the sponsor's party: the same facts give the same score
 * for every party. `null` means not measured (shown as "—", counted as 0).
 */
export interface Facts {
  step: Step;
  /** Words in the newest text version, and whether they were counted or estimated from the file size. */
  words: number | null;
  wordsCounted: boolean;
  /** Largest whole-bill deficit effect CBO gives, $ millions, on the current-law baseline. */
  deficitMusd: number | null;
  /** LD-2 filings that name the bill. */
  lobbyingFilings: number | null;
  /** Sections first seen late: the x-ray lineage when it ran, else sections new in the newest version. */
  lateSections: number | null;
  daysToVote: number | null;
  closedRule: boolean;
  closestVote: Tally | null;
  /** Sections the x-ray labeled buried (big money or lobbying, little news attention). */
  buriedSections: number | null;
}

export type Signal = "moving" | "size" | "dollars" | "lobbying" | "late" | "rushed" | "buried" | "divisive";
export type SubScores = Record<Signal, number | null>;

export const RULES_VERSION = "watch-v1";

export const WEIGHTS: Record<Signal, number> = {
  moving: 0.2,
  size: 0.1,
  dollars: 0.15,
  lobbying: 0.15,
  late: 0.15,
  rushed: 0.1,
  buried: 0.1,
  divisive: 0.05,
};

/** Plain-English rule per signal, printed in every digest. */
export const RULE_TEXT: Record<Signal, string> = {
  moving:
    "How far it moved in the window: became law 1, enrolled/presented/vetoed 0.95, second chamber or conference 0.9, passed a chamber 0.75, floor vote 0.6, other floor action 0.5, reported 0.4, new text 0.35, CBO estimate or calendar 0.3.",
  size: "Words in the newest text, log scale: 1,000 words = 0, 500,000 words = 1.",
  dollars: "Largest CBO whole-bill deficit effect, current-law baseline, log scale: $10M = 0, $1T = 1.",
  lobbying: "LD-2 lobbying filings naming the bill, log scale: 0 = 0, 10 = 0.35, 100 = 0.67, 1,000+ = 1.",
  late: "Sections first seen after the first chamber passed the bill (the x-ray's lineage, else headings in the newest text missing from the first-passed text): sqrt(n)/5, capped at 1 (25+ sections = 1).",
  rushed:
    "Days from the text becoming public (introduction or a substitute amendment) to the floor vote: 0 days = 1, 7 = 0.49, 60+ = 0; at least 0.5 under a closed rule.",
  buried: "Sections the x-ray labeled buried: n/5, capped at 1.",
  divisive: "Closest recorded vote in the window: 1 - |yeas - nays| / (yeas + nays).",
};

const clamp = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 100) / 100;

export function subScores(f: Facts): SubScores {
  const speed = f.daysToVote === null ? null : 1 - clamp(Math.log1p(f.daysToVote) / Math.log1p(60));
  const rushed = speed === null && !f.closedRule ? null : Math.max(speed ?? 0, f.closedRule ? 0.5 : 0);
  const v = f.closestVote;
  const s: SubScores = {
    moving: STEPS[f.step].weight,
    size: f.words === null ? null : clamp(Math.log10(Math.max(f.words, 1) / 1000) / Math.log10(500)),
    dollars: f.deficitMusd === null ? null : clamp((Math.log10(Math.max(Math.abs(f.deficitMusd), 1)) - 1) / 5),
    lobbying: f.lobbyingFilings === null ? null : clamp(Math.log10(1 + f.lobbyingFilings) / 3),
    late: f.lateSections === null ? null : clamp(Math.sqrt(f.lateSections) / 5),
    rushed,
    buried: f.buriedSections === null ? null : clamp(f.buriedSections / 5),
    divisive: v && v.yeas + v.nays > 0 ? 1 - Math.abs(v.yeas - v.nays) / (v.yeas + v.nays) : null,
  };
  for (const k of Object.keys(s) as Signal[]) if (s[k] !== null) s[k] = round(s[k]!);
  return s;
}

/** 0-100: the weighted sum of the sub-scores. */
export function score(s: SubScores): number {
  let total = 0;
  for (const k of Object.keys(WEIGHTS) as Signal[]) total += WEIGHTS[k] * (s[k] ?? 0);
  return Math.round(total * 1000) / 10;
}
