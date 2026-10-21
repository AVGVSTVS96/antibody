import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { type BillId, billDisplay, billstatusUrl, congressGovUrl } from "@antibody/core";
import { paths, readRows, writeRows } from "@antibody/core/node";
import { type BillStatus, parseBillStatus, type TextVersion } from "./billstatus.ts";
import { flaggedOf, links, reasons, withRiders } from "./digest.ts";
import { discover, type SourceReport } from "./discover.ts";
import {
  type BillEvent,
  beforeFloor,
  billEvents,
  closedRule,
  STEPS,
  type Tally,
  type VoteClock,
  voteClock,
  voteQuestion,
} from "./events.ts";
import { cachedText, get, pool } from "./http.ts";
import { lobbyingFilings } from "./lda.ts";
import { type NewsCount, newsCount } from "./news.ts";
import { isSpecialRule, type Rider, ruleRiders } from "./rules.ts";
import { type Facts, type SubScores, score, subScores } from "./score.ts";
import { publishBundle, type Site } from "./site.ts";
import { newSections, textShape, wordsFromBytes } from "./text.ts";
import { runXray, type XrayFacts, type XrayRun, xrayFacts } from "./xray.ts";

export interface Evidence {
  newest: TextVersion | null;
  /** The last text before the first chamber's floor, when the newest text came after it: what "late" is measured against. */
  before: TextVersion | null;
  newSectionSamples: string[];
  lateFrom: "x-ray" | "text-diff" | null;
  lobbyingFrom: "x-ray" | "lda-checked" | null;
  /** Filings read and filings lda.gov's search returned, when the watcher checked them itself. */
  lobbyingChecked: { checked: number; searched: number } | null;
  lobbyingUrls: string[];
  lobbyingClients: number | null;
  closestVoteUrl: string | null;
  /** What the closest vote was on, as the action reads ("On motion to commit Failed"). */
  closestVoteOn?: string | null;
  firstVote: BillEvent | null;
  clock: VoteClock | null;
  news: NewsCount | null;
  /** For a House rule: its sections that do more than set up debate (null when not read). */
  riders: Rider[] | null;
  xray: XrayFacts | null;
}

export interface Candidate {
  status: BillStatus;
  /** Every event in the bill's record, newest first. */
  events: BillEvent[];
  /** Ids of events in the window that no earlier digest reported. */
  fresh: Set<string>;
  facts: Facts;
  evidence: Evidence;
  sub: SubScores;
  score: number;
  xray: XrayRun | null;
}

export interface WatchResult {
  date: string;
  since: string;
  actionsSince: string;
  generatedAt: string;
  sources: SourceReport[];
  candidates: Candidate[];
  /** Bills that moved but whose events were all reported in an earlier digest. */
  alreadyReported: number;
  xrayed: BillId[];
  site: Site;
  problems: string[];
  /** Set when every bill of this Congress was scored on its whole record (`antibody sweep`), not a window. */
  sweep?: number;
}

export const settings = () => ({
  xrays: Number(process.env.ANTIBODY_WATCH_XRAYS ?? 3),
  enrich: Number(process.env.ANTIBODY_WATCH_ENRICH ?? 25),
  since: process.env.ANTIBODY_WATCH_SINCE ?? null,
  publish: process.env.ANTIBODY_WATCH_PUBLISH !== "0",
});

/** BILLSTATUS records an action a day or more after it happens, so an update in the window can carry older actions. */
export const ACTION_LAG_DAYS = 7;

const today = () => new Date().toLocaleDateString("en-CA");
const daysBefore = (date: string, n: number) => new Date(Date.parse(date) - n * 86_400_000).toISOString().slice(0, 10);

/** From the day of the last digest (events seen then are skipped by id), at most 14 days back; 3 days on a first run. */
export async function windowStart(dir: string, date: string): Promise<string> {
  const days = (await readdir(dir).catch(() => [] as string[]))
    .map((f) => f.match(/^(\d{4}-\d{2}-\d{2})\.json$/)?.[1])
    .filter((d): d is string => !!d && d < date)
    .sort();
  const last = days.pop();
  return last ? (last < daysBefore(date, 14) ? daysBefore(date, 14) : last) : daysBefore(date, 3);
}

/** Facts about the bill as a whole: its furthest step, closest vote and haste over its whole record, not one window. */
function baseFacts(s: BillStatus, events: BillEvent[], since: string): { facts: Facts; evidence: Evidence } {
  const voted = events.filter((e) => e.tally);
  const closest = voted.reduce<BillEvent | null>(
    (best, e) => (!best || margin(e.tally!) < margin(best.tally!) ? e : best),
    null,
  );
  const before = beforeFloor(s);
  const clock = voteClock(s, events);
  const firstVote = events.filter((e) => e.tally).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  return {
    facts: {
      step: events.reduce((best, e) => (stepWeight(e) > stepWeight(best) ? e : best)).step,
      words: null,
      wordsCounted: false,
      deficitMusd: null,
      lobbyingFilings: null,
      lateSections: null,
      daysToVote: clock?.days ?? null,
      closedRule: closedRule(s, since),
      closestVote: closest?.tally ?? null,
      buriedSections: null,
      newsStories: null,
    },
    evidence: {
      newest: s.versions[0] ?? null,
      before: before && before !== s.versions[0] ? before : null,
      newSectionSamples: [],
      lateFrom: null,
      lobbyingFrom: null,
      lobbyingChecked: null,
      lobbyingUrls: [],
      lobbyingClients: null,
      closestVoteUrl: closest?.url ?? null,
      closestVoteOn: closest ? voteQuestion(closest.text) : null,
      firstVote,
      clock,
      news: null,
      riders: null,
      xray: null,
    },
  };
}

/**
 * A bill with an event on or after `since` that no earlier digest reported, or null. The window only decides which
 * bills to look at: the score is the bill's own, from its whole record in BILLSTATUS (a bill that passed the House
 * 51 days ago and moves again today is scored as a bill that passed the House).
 */
export function candidate(s: BillStatus, since: string, published?: Map<string, string>, seen = new Set<string>()) {
  const events = billEvents(s, since, published);
  const unseen = events.filter((e) => !seen.has(e.id));
  if (!unseen.length) return null;
  const start = s.introducedOn && s.introducedOn < since ? s.introducedOn : since;
  const record = billEvents(s, start, published);
  const { facts, evidence } = baseFacts(s, record, start);
  const fresh = new Set(unseen.map((e) => e.id));
  const c: Candidate = {
    status: s,
    events: record,
    fresh,
    facts,
    evidence,
    sub: subScores(facts),
    score: 0,
    xray: null,
  };
  rescore(c);
  return c;
}

/** Adds the bill text (size, late sections), the press, the lobbying search and any x-ray tables. Returns what failed. */
export async function enrich(c: Candidate, cache: string, signal?: AbortSignal): Promise<string[]> {
  const id = c.status.id;
  const problems: string[] = [];
  try {
    c.evidence.news = await newsCount(c.status, today(), cache, signal);
    c.facts.newsStories = c.evidence.news.stories;
  } catch (e) {
    problems.push(`${billDisplay(id)} news count: ${(e as Error).message}`);
  }
  await textFacts(c, join(cache, "text"), signal).catch((e) =>
    problems.push(`${billDisplay(id)} text: ${(e as Error).message}`),
  );
  try {
    const { confirmed, checked, searched, urls } = await lobbyingFilings(id, signal);
    c.facts.lobbyingFilings = confirmed;
    c.evidence.lobbyingFrom = "lda-checked";
    c.evidence.lobbyingChecked = { checked, searched };
    c.evidence.lobbyingUrls = urls;
  } catch (e) {
    problems.push(`${billDisplay(id)} lobbying check: ${(e as Error).message}`);
  }
  applyXray(c, await xrayFacts(id));
  return problems;
}

const margin = (t: Tally) => Math.abs(t.yeas - t.nays) / Math.max(1, t.yeas + t.nays);
const stepWeight = (e: BillEvent) => STEPS[e.step].weight;

function rescore(c: Candidate) {
  c.sub = subScores(c.facts);
  c.score = score(c.sub);
}

/** The bills worth an x-ray and a public page: the best flagged ones, at most `n`. A bill under the cutoff is not published. */
export const toXray = (cs: Candidate[], n: number, max?: number) => flaggedOf(rank(cs), max).slice(0, n);

export const rank = (cs: Candidate[]) => cs.sort((a, b) => b.score - a.score || a.status.id.localeCompare(b.status.id));

/** Folds what the x-ray tables hold into the facts; table numbers replace the watcher's own estimates. */
function applyXray(c: Candidate, x: XrayFacts) {
  c.evidence.xray = x;
  if (x.lateSections) {
    c.facts.lateSections = x.lateSections.length;
    c.evidence.lateFrom = "x-ray";
  }
  if (x.deficit) c.facts.deficitMusd = x.deficit.musd;
  if (x.lobbying) {
    c.facts.lobbyingFilings = x.lobbying.filings;
    c.evidence.lobbyingFrom = "x-ray";
    c.evidence.lobbyingClients = x.lobbying.clients;
  }
  if (x.buried) c.facts.buriedSections = x.buried.length;
  rescore(c);
}

export async function watch(log: (m: string) => void, signal?: AbortSignal): Promise<WatchResult> {
  const dir = paths.raw("watch");
  const date = today();
  const cfg = settings();
  const since = cfg.since ?? (await windowStart(dir, date));
  const problems: string[] = [];
  const actionsSince = daysBefore(since, ACTION_LAG_DAYS);
  log(`window ${since} → ${date} (actions from ${actionsSince})`);

  const found = await discover(since, signal);
  for (const s of found.sources) if (!s.ok) problems.push(`${s.name}: ${s.error}`);
  if (found.sources.every((s) => !s.ok)) throw new Error("every discovery source failed");
  log(
    `${found.bills.size} bills touched (${found.sources.filter((s) => s.ok).length}/${found.sources.length} sources)`,
  );

  const seen = await reportedBefore(date);
  const failed: string[] = [];
  let unpublished = 0;
  const statuses = await pool([...found.bills], 6, async ([id, lastmod]) => {
    const stamp = (lastmod ?? date).replace(/[^0-9T]/g, "");
    try {
      return parseBillStatus(
        await cachedText(billstatusUrl(id), join(dir, "cache", "billstatus", `${id}@${stamp}.xml`), { signal }),
      );
    } catch (e) {
      const message = (e as Error).message;
      if (message.startsWith("404 ")) unpublished++;
      else failed.push(`${id}: ${message}`);
      return null;
    }
  });
  if (unpublished) log(`${unpublished} new bills have text but no BILLSTATUS yet`);
  if (failed.length)
    problems.push(`BILLSTATUS unreadable for ${failed.length} bills: ${failed.slice(0, 5).join("; ")}`);

  let alreadyReported = 0;
  const candidates: Candidate[] = [];
  for (const s of statuses) {
    if (!s) continue;
    for (const c of found.cbo.get(s.id) ?? []) if (!s.cbo.some((x) => x.url === c.url)) s.cbo.push(c);
    const c = candidate(s, actionsSince, found.published, seen);
    if (c) candidates.push(c);
    else if (billEvents(s, actionsSince, found.published).length) alreadyReported++;
  }
  log(`${candidates.length} moved with new events (${alreadyReported} already reported)`);

  await measureSize(candidates, signal);
  await readRiders(candidates, join(dir, "cache", "text"), signal);
  const shortlist = rank(candidates).slice(0, cfg.enrich);
  log(`enriching the top ${shortlist.length}: bill text, news, lobbying, x-ray tables`);
  for (const c of shortlist) problems.push(...(await enrich(c, join(dir, "cache"), signal)));

  const site: Site = { published: [], deploy: { status: "pending" } };
  const xrayed = await xrayAndPublish(
    toXray(candidates, cfg.xrays),
    join(dir, "logs", date),
    site,
    problems,
    log,
    signal,
  );
  rank(candidates);

  return {
    date,
    since,
    actionsSince,
    generatedAt: new Date().toISOString(),
    sources: found.sources,
    candidates,
    alreadyReported,
    xrayed,
    site,
    problems,
  };
}

/** Reads the newest text of every House rule among the candidates for riders (rules are a few kilobytes each). */
export async function readRiders(candidates: Candidate[], cache: string, signal?: AbortSignal) {
  await pool(
    candidates.filter((c) => isSpecialRule(c.status)),
    6,
    async (c) => {
      const v = c.evidence.newest;
      if (!v) return;
      try {
        c.evidence.riders = ruleRiders(
          await cachedText(v.xmlUrl, join(cache, `${v.xmlUrl.split("/").pop()}`), { signal }),
        );
      } catch {}
    },
  );
}

/** Words from each newest text's Content-Length, for every candidate (one HEAD request each). */
export async function measureSize(candidates: Candidate[], signal?: AbortSignal) {
  await pool(candidates, 8, async (c) => {
    const url = c.evidence.newest?.xmlUrl;
    if (!url || c.facts.words !== null) return;
    try {
      const res = await get(url, { method: "HEAD", signal });
      const bytes = Number(res.headers.get("content-length"));
      if (bytes) c.facts.words = wordsFromBytes(bytes);
      rescore(c);
    } catch {}
  });
}

/** Runs the x-ray of each bill, publishes the bundles that check out (unless publishing is off), and folds the tables back in. */
export async function xrayAndPublish(
  picks: Candidate[],
  logs: string,
  site: Site,
  problems: string[],
  log: (m: string) => void,
  signal?: AbortSignal,
): Promise<BillId[]> {
  const xrayed: BillId[] = [];
  for (const c of picks) {
    const id = c.status.id;
    log(`x-ray ${billDisplay(id)} (score ${c.score})`);
    c.xray = await runXray(id, logs, signal);
    if (!c.xray.ok) problems.push(`x-ray ${billDisplay(id)} failed: ${c.xray.error} (log ${c.xray.log})`);
    let facts = await xrayFacts(id);
    if (c.xray.ok && !facts.bundle)
      problems.push(`x-ray ${billDisplay(id)} finished but wrote no bundle (log ${c.xray.log})`);
    if (settings().publish && c.xray.ok && facts.bundle) {
      const problem = await publishBundle(id).catch(
        (e: Error) => `${billDisplay(id)} bundle not published: ${e.message}`,
      );
      if (problem) problems.push(problem);
      else site.published.push(id);
      facts = await xrayFacts(id);
    }
    applyXray(c, facts);
    xrayed.push(id);
  }
  return xrayed;
}

async function textFacts(c: Candidate, cache: string, signal?: AbortSignal) {
  const { newest, before } = c.evidence;
  if (!newest) return;
  const read = async (v: TextVersion) =>
    textShape(await cachedText(v.xmlUrl, join(cache, `${v.xmlUrl.split("/").pop()}`), { signal }));
  const now = await read(newest);
  c.facts.words = now.words;
  c.facts.wordsCounted = true;
  if (before) {
    const added = newSections(await read(before), now);
    c.facts.lateSections = added.length;
    c.evidence.lateFrom = "text-diff";
    c.evidence.newSectionSamples = added.slice(0, 3);
  }
  rescore(c);
}

/** Event ids an earlier day's digest reported. Today's own shard doesn't count, so a rerun rebuilds today's digest. */
async function reportedBefore(date: string): Promise<Set<string>> {
  const shards = (await readdir(paths.table("watch_events")).catch(() => [] as string[]))
    .filter((f) => f.endsWith(".jsonl") && f !== `${date}.jsonl`)
    .map((f) => f.slice(0, -".jsonl".length));
  const rows = await Promise.all(shards.map((s) => readRows("watch_events", s)));
  return new Set(rows.flat().map((e) => e.id));
}

/** Every new event, plus one "hot" event per bill the digest flags, appended to today's shard. */
export async function recordEvents(r: WatchResult, flagged: Candidate[]) {
  const seenAt = r.generatedAt;
  const rows = new Map((await readRows("watch_events", r.date)).filter((e) => e.kind !== "hot").map((e) => [e.id, e]));
  for (const c of r.candidates)
    for (const e of c.events)
      if (c.fresh.has(e.id) && !rows.has(e.id))
        rows.set(e.id, {
          id: e.id,
          bill_id: e.bill,
          kind: e.kind,
          seen_at: seenAt,
          url: e.url,
          detail: { step: e.step, date: e.date, text: e.text, tally: e.tally },
        });
  for (const c of [...flagged, ...withRiders(r.candidates)])
    rows.set(`${c.status.id}/hot/${r.date}`, {
      id: `${c.status.id}/hot/${r.date}`,
      bill_id: c.status.id,
      kind: "hot",
      seen_at: seenAt,
      url: links(c).page ?? congressGovUrl(c.status.id),
      detail: {
        display: billDisplay(c.status.id),
        title: c.status.shortTitle ?? c.status.title,
        sponsorParty: c.status.sponsor?.party || null,
        reason: c.evidence.riders?.length
          ? `A House rule that also: ${[...new Set(c.evidence.riders.map((x) => x.label.toLowerCase()))].join("; ")}`
          : reasons(c)
              .slice(0, 2)
              .map((x) => x.text)
              .join("; "),
        score: c.score,
        sub: c.sub,
        facts: c.facts,
        xrayed: r.xrayed.includes(c.status.id),
        bundle: c.evidence.xray?.bundle ?? null,
      },
    });
  await writeRows("watch_events", r.date, [...rows.values()]);
}
