import { type BillId, billRef, congressGovUrl, parseBillId } from "@antibody/core";
import type { Action, BillStatus, TextVersion } from "./billstatus.ts";

/** How far along a bill moved, strongest first. The weight is the `moving` sub-score. */
export const STEPS = {
  law: { weight: 1, label: "became law" },
  vetoed: { weight: 0.95, label: "was vetoed" },
  presented: { weight: 0.95, label: "went to the President" },
  enrolled: { weight: 0.95, label: "got its enrolled (final) text" },
  resolving: { weight: 0.9, label: "is being reconciled between the chambers" },
  passed_second: { weight: 0.9, label: "passed its second chamber" },
  passed: { weight: 0.75, label: "passed a chamber" },
  failed: { weight: 0.6, label: "failed a floor vote" },
  vote: { weight: 0.6, label: "had a floor vote" },
  floor: { weight: 0.5, label: "was on the floor" },
  reported: { weight: 0.4, label: "was reported by committee" },
  new_version: { weight: 0.35, label: "got a new text version" },
  cbo_estimate: { weight: 0.3, label: "got a CBO cost estimate" },
  calendar: { weight: 0.3, label: "was placed on a calendar" },
} as const;
export type Step = keyof typeof STEPS;

export interface Tally {
  yeas: number;
  nays: number;
}

export interface BillEvent {
  id: string;
  bill: BillId;
  kind: "action" | "floor_vote" | "new_version" | "enrolled" | "cbo_estimate";
  step: Step;
  date: string;
  text: string;
  url: string;
  tally: Tally | null;
}

const TALLY = /(?:Yeas and Nays|recorded vote|Yea-Nay Vote)\.?:?\s*(\d+)\s*-\s*(\d+)/i;

export function tally(text: string): Tally | null {
  const m = text.match(TALLY);
  return m ? { yeas: +m[1]!, nays: +m[2]! } : null;
}

const passedIn = (a: Action) => a.text.match(/^Passed\/agreed to in (House|Senate)/)?.[1] ?? null;

export function classify(a: Action, passedBefore: Set<string>): Step | null {
  const t = a.text;
  if (a.type === "BecameLaw" || /Became (Public|Private) Law/.test(t)) return "law";
  if (a.type === "Veto" || /Vetoed by President/i.test(t)) return "vetoed";
  if (/^Presented to President/.test(t)) return "presented";
  if (a.type === "ResolvingDifferences" || /conference report|Resolving differences/i.test(t)) return "resolving";
  const chamber = passedIn(a);
  if (chamber) return [...passedBefore].some((c) => c !== chamber) ? "passed_second" : "passed";
  if (/^Failed of passage|^Failed to pass|motion to proceed rejected|cloture .*not invoked/i.test(t)) return "failed";
  if (a.votes.length || tally(t)) return "vote";
  if (a.type === "Floor" && !/amendment submitted|^Received in the|^Held at the desk|^Message on/i.test(t))
    return "floor";
  if (a.type === "Committee" && /reported|ordered to be reported/i.test(t)) return "reported";
  if (a.type === "Calendars") return "calendar";
  return null;
}

/**
 * Everything that happened to the bill on or after `since`: floor and committee actions, recorded votes,
 * new text versions and CBO estimates. `published` holds GovInfo publication dates for text packages
 * (enrolled bills carry no date in BILLSTATUS).
 */
export function billEvents(s: BillStatus, since: string, published: Map<string, string> = new Map()): BillEvent[] {
  const byKey = new Map<string, BillEvent>();
  const add = (e: BillEvent) => {
    const prior = byKey.get(e.id);
    const rank = (x: BillEvent) => STEPS[x.step].weight + (x.tally ? 0.01 : 0);
    if (!prior || rank(e) > rank(prior)) byKey.set(e.id, e);
  };
  const passed = new Set<string>();
  const actionsUrl = `${congressGovUrl(s.id)}/all-actions`;
  for (const a of [...s.actions].sort((x, y) => x.date.localeCompare(y.date))) {
    const step = classify(a, passed);
    const chamber = passedIn(a);
    if (chamber) passed.add(chamber);
    if (!step || a.date < since) continue;
    const vote = a.votes[0];
    const key = vote ? `${vote.chamber[0]!.toLowerCase()}${vote.roll}` : step;
    add({
      id: `${s.id}/${vote ? "floor_vote" : "action"}/${a.date}/${key}`,
      bill: s.id,
      kind: vote ? "floor_vote" : "action",
      step,
      date: a.date,
      text: a.text,
      url: vote?.url ?? actionsUrl,
      tally: tally(a.text),
    });
  }
  for (const v of s.versions) {
    const date = v.date ?? published.get(`BILLS-${packageStem(s.id)}${v.code}`) ?? null;
    if (!date || date < since || INTRODUCED.has(v.code)) continue;
    const enrolled = v.code === "enr";
    add({
      id: `${s.id}/${enrolled ? "enrolled" : "new_version"}/${v.code}`,
      bill: s.id,
      kind: enrolled ? "enrolled" : "new_version",
      step: enrolled ? "enrolled" : "new_version",
      date,
      text: `${v.name} text published on GovInfo`,
      url: v.xmlUrl,
      tally: null,
    });
  }
  for (const c of s.cbo)
    if (c.publishedOn >= since)
      add({
        id: `${s.id}/cbo_estimate/${c.url.split("/").pop()}`,
        bill: s.id,
        kind: "cbo_estimate",
        step: "cbo_estimate",
        date: c.publishedOn,
        text: `CBO: ${c.title}${c.description ? ` (${c.description})` : ""}`,
        url: c.url,
        tally: null,
      });
  const rolled = new Set([...byKey.values()].filter((e) => e.kind === "floor_vote").map(voteKey));
  return [...byKey.values()]
    .filter((e) => e.kind !== "action" || !e.tally || !rolled.has(voteKey(e)))
    .sort((a, b) => b.date.localeCompare(a.date) || STEPS[b.step].weight - STEPS[a.step].weight);
}

const INTRODUCED = new Set(["ih", "is", "iph", "ips"]);

/** The text the first chamber passed (engrossed in the chamber the bill started in): the baseline for "late". */
export function passedVersion(s: BillStatus): TextVersion | null {
  const code = s.id.split("-")[1]!.startsWith("h") ? "eh" : "es";
  return s.versions.find((v) => v.code === code) ?? null;
}

const voteKey = (e: BillEvent) => `${e.date}/${e.tally?.yeas}-${e.tally?.nays}`;

export const packageStem = (id: BillId) => id.replace(/-/g, "");

/** True when a House rule in the bill's actions brings it up under a closed rule (no floor amendments). */
export function closedRule(s: BillStatus, since: string): boolean {
  return s.actions.some((a) => a.date >= since && closedRuleBills(a.text, s.id).includes(s.id));
}

const RULE = /under an? (closed|structured|open|modified[- ](?:open|closed)) rule/gi;
const BILL_REF = /\b(H\.\s?R\.|S\.|H\.\s?J\.\s?Res\.|S\.\s?J\.\s?Res\.)\s?(\d+)/g;

/** Bills a rule's text puts "under a closed rule": those named between the previous rule clause and this one. */
export function closedRuleBills(text: string, of: BillId): BillId[] {
  const congress = billRef(of).congress;
  const out: BillId[] = [];
  let from = 0;
  for (const m of text.matchAll(RULE)) {
    const start = Math.max(from, text.lastIndexOf("consideration of", m.index));
    if (m[1]!.toLowerCase() === "closed")
      for (const b of text.slice(start, m.index).matchAll(BILL_REF)) out.push(parseBillId(`${b[1]} ${b[2]}`, congress));
    from = m.index + m[0].length;
  }
  return out;
}

export interface VoteClock {
  days: number;
  /** What started the clock: the bill's introduction or a substitute amendment (e.g. "samdt2307"). */
  from: "introduced" | string;
  startedOn: string;
  voteOn: string;
}

/**
 * Days between the text the chamber voted on becoming public (introduction, or a later substitute amendment)
 * and the first floor vote or passage among `events`. null when nothing reached the floor.
 */
export function voteClock(s: BillStatus, events: BillEvent[]): VoteClock | null {
  const voteOn = events
    .filter((e) => ["passed", "passed_second", "failed", "vote", "resolving"].includes(e.step))
    .map((e) => e.date)
    .sort()[0];
  if (!voteOn) return null;
  const starts = [
    { from: "introduced", on: s.introducedOn },
    ...s.amendments
      .filter((a) => /nature of a substitute/i.test(a.purpose ?? ""))
      .map((a) => ({ from: a.id, on: a.submittedOn })),
  ].filter((x): x is { from: string; on: string } => !!x.on && x.on <= voteOn);
  const start = starts.sort((a, b) => a.on.localeCompare(b.on)).pop();
  if (!start) return null;
  const days = Math.round((Date.parse(voteOn) - Date.parse(start.on)) / 86_400_000);
  return { days, from: start.from, startedOn: start.on, voteOn };
}
