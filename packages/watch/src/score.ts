import { STEPS } from "./events.ts";
import type { Step, Tally } from "./events.ts";

export interface Facts {
  step: Step;
  words: number | null;
  wordsCounted: boolean;
  deficitMusd: number | null;
  lobbyingFilings: number | null;
  lateSections: number | null;
  daysToVote: number | null;
  closedRule: boolean;
  closestVote: Tally | null;
  buriedSections: number | null;
  newsStories: number | null;
}

export const SIGNALS = [
  "moving",
  "attention",
  "size",
  "dollars",
  "lobbying",
  "late",
  "rushed",
  "buried",
  "divisive",
] as const;

export type Signal = (typeof SIGNALS)[number];

export type SubScores = Record<Signal, number | null>;

export const RULES_VERSION = "watch-v3";

export const FLAG_CUTOFF = 25;
export const MAX_FLAGGED = 25;

export const WEIGHTS: Record<Signal, number> = {
  moving: 0.15,
  attention: 0.2,
  size: 0.1,
  dollars: 0.15,
  lobbying: 0.1,
  late: 0.1,
  rushed: 0.05,
  buried: 0.05,
  divisive: 0.1,
};

export const RULE_TEXT: Record<Signal, string> = {
  moving:
    "How far the bill has got in its whole record (the window only decides which bills are looked at): became law 1, enrolled/presented/vetoed 0.95, second chamber or conference 0.9, passed a chamber 0.75, floor vote 0.6, other floor action 0.5, reported 0.4, new text 0.35, CBO estimate or calendar 0.3.",
  attention:
    "News stories naming the bill by its short title or number in the counted outlet list (Media Cloud), from a week before introduction to 30 days after it became law, each side of the list (left, center, right) weighted equally, log scale: 0 = 0, 10 = 0.35, 100 = 0.67, 1,000+ = 1.",
  size: "Words in the newest text, log scale: 1,000 words = 0, 500,000 words = 1.",
  dollars: "Largest CBO whole-bill deficit effect, current-law baseline, log scale: $10M = 0, $1T = 1.",
  lobbying:
    "LD-2 lobbying filings that cite the bill's number (each read and checked, not the search count), log scale: 0 = 0, 10 = 0.35, 100 = 0.67, 1,000+ = 1.",
  late: "Sections first seen on the floor or later (the x-ray's lineage, else headings in the newest text missing from the last text before the first chamber passed it, so a section a rule or floor substitute added counts): sqrt(n)/5, capped at 1 (25+ sections = 1).",
  rushed:
    "Days from the text becoming public (introduction or a substitute amendment) to the floor vote: 0 days = 1, 7 = 0.49, 60+ = 0; at least 0.5 under a closed rule.",
  buried: "Sections the x-ray labeled buried: n/5, capped at 1.",
  divisive: "Closest recorded floor vote in the bill's record: 1 - |yeas - nays| / (yeas + nays).",
};

const clamp = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 100) / 100;

export function subScores(f: Facts): SubScores {
  const speed = f.daysToVote === null ? null : 1 - clamp(Math.log1p(f.daysToVote) / Math.log1p(60));
  const rushed = speed === null && !f.closedRule ? null : Math.max(speed ?? 0, f.closedRule ? 0.5 : 0);
  const v = f.closestVote;

  const s: SubScores = {
    moving: STEPS[f.step].weight,
    attention: f.newsStories === null ? null : clamp(Math.log10(1 + f.newsStories) / 3),
    size: f.words === null ? null : clamp(Math.log10(Math.max(f.words, 1) / 1000) / Math.log10(500)),
    dollars: f.deficitMusd === null ? null : clamp((Math.log10(Math.max(Math.abs(f.deficitMusd), 1)) - 1) / 5),
    lobbying: f.lobbyingFilings === null ? null : clamp(Math.log10(1 + f.lobbyingFilings) / 3),
    late: f.lateSections === null ? null : clamp(Math.sqrt(f.lateSections) / 5),
    rushed,
    buried: f.buriedSections === null ? null : clamp(f.buriedSections / 5),
    divisive: v && v.yeas + v.nays > 0 ? 1 - Math.abs(v.yeas - v.nays) / (v.yeas + v.nays) : null,
  };

  for (const k of SIGNALS) {
    const value = s[k];

    if (value !== null) {
      s[k] = round(value);
    }
  }

  return s;
}

export function score(s: SubScores): number {
  let total = 0;

  for (const k of SIGNALS) {
    total += WEIGHTS[k] * (s[k] ?? 0);
  }

  return Math.round(total * 1000) / 10;
}
