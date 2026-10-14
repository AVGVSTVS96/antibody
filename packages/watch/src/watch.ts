import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { type BillId, billDisplay, billstatusUrl, congressGovUrl } from "@antibody/core";
import { paths, readRows, writeRows } from "@antibody/core/node";
import { type BillStatus, parseBillStatus, type TextVersion } from "./billstatus.ts";
import { discover, type SourceReport } from "./discover.ts";
import {
  type BillEvent,
  billEvents,
  closedRule,
  passedVersion,
  STEPS,
  type Tally,
  type VoteClock,
  voteClock,
} from "./events.ts";
import { cachedText, get, pool } from "./http.ts";
import { lobbyingFilings } from "./lda.ts";
import { type Facts, type SubScores, score, subScores } from "./score.ts";
import { newSections, textShape, wordsFromBytes } from "./text.ts";
import { runXray, type XrayFacts, type XrayRun, xrayFacts } from "./xray.ts";

export interface Evidence {
  newest: TextVersion | null;
  /** The first-passed text, when the newest text came after it: what "late" is measured against. */
  passed: TextVersion | null;
  newSectionSamples: string[];
  lateFrom: "x-ray" | "text-diff" | null;
  lobbyingFrom: "x-ray" | "lda-search" | null;
  lobbyingUrls: string[];
  lobbyingClients: number | null;
  closestVoteUrl: string | null;
  firstVote: BillEvent | null;
  clock: VoteClock | null;
  xray: XrayFacts | null;
}

export interface Candidate {
  status: BillStatus;
  events: BillEvent[];
  /** Ids of events no earlier digest reported. */
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
  problems: string[];
}

export const settings = () => ({
  xrays: Number(process.env.ANTIBODY_WATCH_XRAYS ?? 3),
  enrich: Number(process.env.ANTIBODY_WATCH_ENRICH ?? 25),
  since: process.env.ANTIBODY_WATCH_SINCE ?? null,
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

function baseFacts(s: BillStatus, events: BillEvent[], since: string): { facts: Facts; evidence: Evidence } {
  const voted = events.filter((e) => e.tally);
  const closest = voted.reduce<BillEvent | null>(
    (best, e) => (!best || margin(e.tally!) < margin(best.tally!) ? e : best),
    null,
  );
  const passed = passedVersion(s);
  const clock = voteClock(s, events);
  const firstVote =
    events
      .filter((e) => ["passed", "passed_second", "failed", "vote", "resolving"].includes(e.step))
      .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
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
    },
    evidence: {
      newest: s.versions[0] ?? null,
      passed: passed && passed !== s.versions[0] ? passed : null,
      newSectionSamples: [],
      lateFrom: null,
      lobbyingFrom: null,
      lobbyingUrls: [],
      lobbyingClients: null,
      closestVoteUrl: closest?.url ?? null,
      firstVote,
      clock,
      xray: null,
    },
  };
}

/** A bill that moved on or after `since`, scored on what BILLSTATUS alone says; null when nothing moved. */
export function candidate(s: BillStatus, since: string, published?: Map<string, string>, seen = new Set<string>()) {
  const events = billEvents(s, since, published);
  if (!events.length) return null;
  const { facts, evidence } = baseFacts(s, events, since);
  const fresh = new Set(events.filter((e) => !seen.has(e.id)).map((e) => e.id));
  const c: Candidate = { status: s, events, fresh, facts, evidence, sub: subScores(facts), score: 0, xray: null };
  rescore(c);
  return c;
}

/** Adds the bill text (size, late sections), the lobbying search and any x-ray tables. Returns what failed. */
export async function enrich(c: Candidate, cache: string, signal?: AbortSignal): Promise<string[]> {
  const id = c.status.id;
  const problems: string[] = [];
  await textFacts(c, join(cache, "text"), signal).catch((e) =>
    problems.push(`${billDisplay(id)} text: ${(e as Error).message}`),
  );
  try {
    const { count, urls } = await lobbyingFilings(id, c.status.shortTitle, signal);
    c.facts.lobbyingFilings = count;
    c.evidence.lobbyingFrom = "lda-search";
    c.evidence.lobbyingUrls = urls;
  } catch (e) {
    problems.push(`${billDisplay(id)} lobbying search: ${(e as Error).message}`);
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

  const seen = new Set((await readRows("watch_events")).map((e) => e.id));
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
    if (!c) continue;
    if (!c.fresh.size) alreadyReported++;
    else candidates.push(c);
  }
  log(`${candidates.length} moved with new events (${alreadyReported} already reported)`);

  await pool(candidates, 8, async (c) => {
    const url = c.evidence.newest?.xmlUrl;
    if (!url) return;
    try {
      const res = await get(url, { method: "HEAD", signal });
      const bytes = Number(res.headers.get("content-length"));
      if (bytes) c.facts.words = wordsFromBytes(bytes);
      rescore(c);
    } catch {}
  });

  const shortlist = rank(candidates).slice(0, cfg.enrich);
  log(`enriching the top ${shortlist.length}: bill text, lobbying, x-ray tables`);
  for (const c of shortlist) problems.push(...(await enrich(c, join(dir, "cache"), signal)));

  const xrayed: BillId[] = [];
  const logs = join(dir, "logs", date);
  for (const c of rank(candidates).slice(0, cfg.xrays)) {
    const id = c.status.id;
    log(`x-ray ${billDisplay(id)} (score ${c.score})`);
    c.xray = await runXray(id, logs, signal);
    if (!c.xray.ok) problems.push(`x-ray ${billDisplay(id)} failed: ${c.xray.error} (log ${c.xray.log})`);
    applyXray(c, await xrayFacts(id));
    xrayed.push(id);
  }
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
    problems,
  };
}

async function textFacts(c: Candidate, cache: string, signal?: AbortSignal) {
  const { newest, passed } = c.evidence;
  if (!newest) return;
  const read = async (v: TextVersion) =>
    textShape(await cachedText(v.xmlUrl, join(cache, `${v.xmlUrl.split("/").pop()}`), { signal }));
  const now = await read(newest);
  c.facts.words = now.words;
  c.facts.wordsCounted = true;
  if (passed) {
    const added = newSections(await read(passed), now);
    c.facts.lateSections = added.length;
    c.evidence.lateFrom = "text-diff";
    c.evidence.newSectionSamples = added.slice(0, 3);
  }
  rescore(c);
}

/** Every new event, plus one "hot" event per bill the digest flags, appended to today's shard. */
export async function recordEvents(r: WatchResult, flagged: Candidate[], pageUrl: (id: BillId) => string | null) {
  const seenAt = r.generatedAt;
  const rows = new Map((await readRows("watch_events", r.date)).map((e) => [e.id, e]));
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
  for (const c of flagged)
    rows.set(`${c.status.id}/hot/${r.date}`, {
      id: `${c.status.id}/hot/${r.date}`,
      bill_id: c.status.id,
      kind: "hot",
      seen_at: seenAt,
      url: pageUrl(c.status.id) ?? congressGovUrl(c.status.id),
      detail: { score: c.score, sub: c.sub, facts: c.facts, xrayed: r.xrayed.includes(c.status.id) },
    });
  await writeRows("watch_events", r.date, [...rows.values()]);
}
