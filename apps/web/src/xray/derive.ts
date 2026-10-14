import { BURIED_BARS, type Bundle, type Dollar, headlineDeficit } from "@antibody/core";
import { count, day } from "../lib/format.ts";
import type { BillModel, Near, SectionView } from "../lib/model.ts";
import type { Tape, TapeRow } from "../lib/tape.ts";

export const OUTLETS_URL = "https://github.com/AVGVSTVS96/antibody/blob/main/packages/ingest-news/data/outlets.json";

type Estimate = Bundle["dollars"]["estimates"][number];
type OutletGroup = "left" | "center-left" | "center" | "center-right" | "right";

export interface Passage {
  chamber: string;
  date: string;
  yeas: number;
  nays: number;
  concur: boolean;
  tie: boolean;
  claim: string;
}

const PASSES = /on passage|and pass\b|motion to concur/i;
const NOT_PASSAGE = /commit|waive|decision of the chair|table|cloture/i;

/** The roll calls on which a chamber passed the bill or concurred in the other's version, oldest first. */
export function passages(votes: Bundle["votes"]): Passage[] {
  return votes
    .filter((v) => PASSES.test(v.question) && !NOT_PASSAGE.test(v.question) && /passed|agreed/i.test(v.result))
    .sort((a, b) => a.date.localeCompare(b.date) || a.number - b.number)
    .map((v) => ({
      chamber: v.chamber,
      date: v.date,
      yeas: v.yeas,
      nays: v.nays,
      concur: /concur/i.test(v.question),
      tie: /tie broken/i.test(v.result),
      claim: v.claim,
    }));
}

/** "The House passed it 215–214 on May 22, 2025, the Senate passed it 50–50 on Jul 1, 2025 (the Vice President broke the tie), …". */
export function passageText(ps: Passage[]): string {
  const clauses = ps.map(
    (p, i) =>
      `${i ? "the" : "The"} ${p.chamber} ${p.concur ? "concurred" : "passed it"} ${p.yeas}–${p.nays} on ${day(p.date)}${p.tie ? " (the Vice President broke the tie)" : ""}`,
  );
  if (clauses.length < 2) return `${clauses[0] ?? ""}.`;
  return `${clauses.slice(0, -1).join(", ")}, and ${clauses.at(-1)}.`;
}

export interface Baseline {
  baseline: Dollar["baseline"];
  dollar: Dollar;
  estimate: Estimate;
}

/** The whole-bill deficit CBO gives on each baseline it published one for: law first, then policy. */
export function baselines(b: Bundle): Baseline[] {
  const estimates = new Map(b.dollars.estimates.map((e) => [e.id, e]));
  return (["current-law", "current-policy"] as const).flatMap((baseline) => {
    const dollar = headlineDeficit(b, baseline);
    const estimate = dollar && estimates.get(dollar.estimateId);
    return dollar && estimate ? [{ baseline, dollar, estimate }] : [];
  });
}

/** "The closest was Rulemaking (§13), scored 0.85, above the 0.45 the rule needs, but it was not added late." */
export function nearly(m: BillModel, { v, score, missed }: Near): string {
  const bar = BURIED_BARS.score;
  return `The closest was ${v.s.heading} (${m.secLabel(v)}), scored ${score.toFixed(2)}, ${score >= bar ? "above" : "under"} the ${bar} the rule needs${missed.length ? `, but ${missed.join("; ")}` : ""}.`;
}

export type Filter = "all" | "loud" | "quiet" | "late" | "lobbied";
export type Sort = "order" | "cost" | "news";

export const FILTERS: { id: Filter; label: string; short: string; test: (r: TapeRow) => boolean }[] = [
  { id: "all", label: "All sections", short: "All", test: () => true },
  { id: "loud", label: "Loud", short: "Loud", test: (r) => r.kind === "headline" },
  { id: "quiet", label: "Quiet and costly", short: "Quiet", test: (r) => r.kind === "quiet" },
  { id: "late", label: "Added late", short: "Late", test: (r) => r.late },
  { id: "lobbied", label: "Named by lobbyists", short: "Lobbied", test: (r) => r.lobbying > 0 },
];

export const counts = (rows: TapeRow[]) =>
  Object.fromEntries(FILTERS.map((f) => [f.id, rows.filter(f.test).length])) as Record<Filter, number>;

const SORTS: Record<Sort, (a: TapeRow, b: TapeRow) => number> = {
  order: (a, b) => a.index - b.index,
  cost: (a, b) => Math.abs(b.musd ?? -1) - Math.abs(a.musd ?? -1) || a.index - b.index,
  news: (a, b) => (b.articles ?? -1) - (a.articles ?? -1) || a.index - b.index,
};

export function select(rows: TapeRow[], filter: Filter, sort: Sort): TapeRow[] {
  const test = FILTERS.find((f) => f.id === filter)!.test;
  return rows.filter(test).sort(SORTS[sort]);
}

export interface Contrast {
  loud: TapeRow;
  quiet: TapeRow;
}

/** The loud and the quiet-and-costly section whose exact CBO figures, both adding or both cutting, are closest on a log scale. */
export function contrast(rows: TapeRow[]): Contrast | null {
  const exact = rows.filter((r) => r.musd && !r.evenSplit);
  let best: { pair: Contrast; gap: number } | null = null;
  for (const quiet of exact.filter((r) => r.kind === "quiet"))
    for (const loud of exact.filter((r) => r.kind === "headline" && Math.sign(r.musd!) === Math.sign(quiet.musd!))) {
      const gap = Math.abs(Math.log10(Math.abs(quiet.musd!) / Math.abs(loud.musd!)));
      if (!best || gap < best.gap) best = { pair: { loud, quiet }, gap };
    }
  return best?.pair ?? null;
}

export const LEAN: readonly [OutletGroup, string][] = [
  ["left", "Left"],
  ["center-left", "Ctr-left"],
  ["center", "Center"],
  ["center-right", "Ctr-right"],
  ["right", "Right"],
];

export interface Lean {
  /** Article matches of final sections by the outlet's lean, and the claims behind them. */
  sections: Record<OutletGroup, number>;
  sectionClaims: string[];
  /** Articles about the bill as a whole or outside its text. */
  general: Record<OutletGroup, number>;
  generalClaim: string | null;
  /** Trade and legal press matches, counted apart. */
  tradeLegal: number;
}

export function leanOf(b: Bundle): Lean {
  const zero = () => ({ left: 0, "center-left": 0, center: 0, "center-right": 0, right: 0 });
  const sections = zero();
  const sectionClaims: string[] = [];
  let tradeLegal = 0;
  for (const s of b.sections) {
    if (!s.inFinal || !s.attention) continue;
    tradeLegal += s.attention.tradeLegalHits;
    if (s.attention.hits) sectionClaims.push(s.attention.claim);
    for (const [g, n] of Object.entries(s.attention.hitsByGroup)) sections[g as OutletGroup] += n ?? 0;
  }
  const general = { ...zero(), ...b.attention.general?.hitsByGroup };
  return {
    sections,
    sectionClaims,
    general,
    generalClaim: b.attention.general?.claim ?? null,
    tradeLegal: tradeLegal + (b.attention.general?.tradeLegalHits ?? 0),
  };
}

export const sum = (o: Record<string, number>) => Object.values(o).reduce((a, n) => a + n, 0);

const DAY = 864e5;
const span = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

export function ago(days: number): string {
  if (days >= 14) return `${Math.round(days / 7)} weeks`;
  return count(days, "day");
}

export interface Seen {
  ticks: { code: string; name: string; date: string | null; x: number; present: boolean; first: boolean }[];
  text: string;
  inference: boolean;
  claims: string[];
}

/** Where the section first shows up among the bill's versions, and how that sits against the first passage vote. */
export function seenOf(m: BillModel, v: SectionView, firstPass: Passage | undefined): Seen {
  const { versions } = m;
  const present = new Set(Object.keys(v.s.history));
  const first = versions[v.stage];
  const times = versions.map((x) => (x.date ? Date.parse(x.date) : Number.NaN));
  const dated = times.every((t) => !Number.isNaN(t)) && times[0] !== times.at(-1);
  const ticks = versions.map((x, i) => ({
    code: x.code,
    name: x.name,
    date: x.date,
    x: dated ? (times[i]! - times[0]!) / (times.at(-1)! - times[0]!) : i / Math.max(versions.length - 1, 1),
    present: present.has(x.code),
    first: i === v.stage,
  }));
  const when = first?.date ? ` on ${day(first.date)}` : "";
  let text: string;
  if (first?.predecessor)
    text = `The section's text first appears in ${v.stageName}${when}, the text of an earlier bill. Linking it to this section is an inference.`;
  else if (v.s.late && firstPass && first?.date)
    text = `Not in the text the ${firstPass.chamber} passed on ${day(firstPass.date)}. First in ${v.stageName}${when}, ${ago(span(firstPass.date, first.date))} after.`;
  else text = `First in ${v.stageName}${when}.`;
  if (v.s.changedIn.length) text += ` Reworded in ${count(v.s.changedIn.length, "later version")}.`;
  return {
    ticks,
    text,
    inference: !!first?.predecessor,
    claims: [first?.claim, v.s.claims[0]].filter((c): c is string => !!c),
  };
}

export interface Lobbying {
  /** Filings that name the section: the count its score used. */
  named: number;
  /** Of those, the reports from clients the bundle draws, and how many clients. */
  drawn: number;
  clients: number;
  /** What backs the named count (the score's), and what backs the drawn part (the lobbied edges). */
  namedClaims: string[];
  drawnClaims: string[];
}

const edgesOf = new WeakMap<BillModel, Map<string, { clients: Set<string>; claims: string[] }>>();

/** The lobbying behind a section: the filings that name it, and the part of them from clients the bundle draws. */
export function lobbyingOf(m: BillModel, v: SectionView): Lobbying {
  let by = edgesOf.get(m);
  if (!by) {
    by = new Map();
    for (const e of m.edges) {
      if (e.kind !== "lobbied" || !e.dst.startsWith("section:")) continue;
      const id = e.dst.slice(8);
      const l = by.get(id) ?? { clients: new Set(), claims: [] };
      l.clients.add(e.src);
      l.claims.push(...e.claims);
      by.set(id, l);
    }
    edgesOf.set(m, by);
  }
  const drawn = by.get(v.s.id);
  return {
    named: v.named,
    drawn: v.drawn,
    clients: drawn?.clients.size ?? 0,
    namedClaims: v.s.score ? [v.s.score.claim] : (drawn?.claims ?? []),
    drawnClaims: drawn?.claims ?? [],
  };
}

const quote = (s: string) => (/[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
const MARK = { headline: "headline", quiet: "quiet and costly", other: "other" } as const;

/** The listed sections as CSV, each figure with the baseline it is on. */
export function csv(rows: TapeRow[], tape: Tape): string {
  const head = [
    "section",
    "heading",
    "mark",
    "added_late",
    "cbo_deficit_effect_musd",
    "cbo_baseline",
    "cbo_figure_basis",
    "news_articles_matched",
    "news_articles_read",
    "lobbying_reports",
    "first_seen_in",
    "text_url",
  ];
  const lines = rows.map((r) => {
    const f = r.view.figure;
    return [
      r.label,
      r.heading,
      MARK[r.kind],
      tape.lateKnown ? (r.late ? "yes" : "no") : "unknown",
      r.musd ?? "",
      f?.estimate.baselineLabel ?? "",
      f ? (r.evenSplit ? "even split (inference)" : "exact") : "none",
      r.articles ?? "",
      tape.read,
      r.lobbying,
      r.view.stageName,
      r.view.s.textUrl,
    ]
      .map((c) => quote(String(c)))
      .join(",");
  });
  return `${[head.join(","), ...lines].join("\n")}\n`;
}

/** A signed CBO figure the way the boards print it: "+$29.7B", "−$366B", "+$3.39T". */
export function signed(m: number): string {
  const a = Math.abs(m);
  const body =
    a < 1e3 ? `$${Math.round(a)}M` : a < 1e6 ? `$${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}B` : `$${(a / 1e6).toFixed(2)}T`;
  return m === 0 ? "$0" : `${m > 0 ? "+" : "−"}${body}`;
}

export const cost = (r: TapeRow) => (r.musd == null ? "—" : signed(r.musd));

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "May–Jul 2025", or "Dec 2024–Feb 2025" across a new year. */
export function months([from, to]: readonly [string, string]): string {
  const [y1, m1] = from.split("-").map(Number) as [number, number];
  const [y2, m2] = to.split("-").map(Number) as [number, number];
  if (y1 === y2) return m1 === m2 ? `${MONTH[m1 - 1]} ${y1}` : `${MONTH[m1 - 1]}–${MONTH[m2 - 1]} ${y1}`;
  return `${MONTH[m1 - 1]} ${y1}–${MONTH[m2 - 1]} ${y2}`;
}

/** "10 YR" for 2025-2034: the years a CBO period covers. */
export function years(period: string): string {
  const [from, to] = period.split("-").map(Number) as [number, number];
  return `${(to ?? from) - from + 1} YR`;
}

/** The titles, subtitles and chapters two sections share, outermost first. */
export function commonPlace(a: string[], b: string[]): string[] {
  const n = a.findIndex((p, i) => b[i] !== p);
  return a.slice(0, n < 0 ? a.length : n);
}
