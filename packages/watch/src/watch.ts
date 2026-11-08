import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { billDisplay, billstatusUrl, congressGovUrl } from "@antibody/core";
import type { BillId } from "@antibody/core";
import { paths, readRows, writeRows } from "@antibody/core/node";
import { parseBillStatus } from "./billstatus.ts";
import type { BillStatus, TextVersion } from "./billstatus.ts";
import { flaggedOf, links, reasons, withRiders } from "./digest.ts";
import { discover } from "./discover.ts";
import type { SourceReport } from "./discover.ts";
import { beforeFloor, billEvents, closedRule, STEPS, voteClock, voteQuestion } from "./events.ts";
import type { BillEvent, Tally, VoteClock } from "./events.ts";
import { cachedText, get, pool } from "./http.ts";
import { lobbyingFilings } from "./lda.ts";
import { newsCount } from "./news.ts";
import type { NewsCount } from "./news.ts";
import { isSpecialRule, ruleRiders } from "./rules.ts";
import type { Rider } from "./rules.ts";
import { score, subScores } from "./score.ts";
import type { Facts, SubScores } from "./score.ts";
import { publishBundle } from "./site.ts";
import type { Site } from "./site.ts";
import { newSections, textShape, wordsFromBytes } from "./text.ts";
import { runXray, xrayFacts } from "./xray.ts";
import type { XrayFacts, XrayRun } from "./xray.ts";

export interface Evidence {
  newest: TextVersion | null;
  before: TextVersion | null;
  newSectionSamples: string[];
  lateFrom: "x-ray" | "text-diff" | null;
  lobbyingFrom: "x-ray" | "lda-checked" | null;
  lobbyingChecked: { checked: number; searched: number } | null;
  lobbyingUrls: string[];
  lobbyingClients: number | null;
  closestVoteUrl: string | null;
  closestVoteOn?: string | null;
  firstVote: BillEvent | null;
  clock: VoteClock | null;
  news: NewsCount | null;
  riders: Rider[] | null;
  xray: XrayFacts | null;
}

export interface Candidate {
  status: BillStatus;
  events: BillEvent[];
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
  alreadyReported: number;
  xrayed: BillId[];
  site: Site;
  problems: string[];
  sweep?: number;
}

interface BaseFacts {
  facts: Facts;
  evidence: Evidence;
}

export const settings = () => ({
  xrays: Number(process.env.ANTIBODY_WATCH_XRAYS ?? 3),
  enrich: Number(process.env.ANTIBODY_WATCH_ENRICH ?? 25),
  since: process.env.ANTIBODY_WATCH_SINCE ?? null,
  publish: process.env.ANTIBODY_WATCH_PUBLISH !== "0",
});

export const ACTION_LAG_DAYS = 7;

const today = () => new Date().toLocaleDateString("en-CA");
const daysBefore = (date: string, n: number) => new Date(Date.parse(date) - n * 86_400_000).toISOString().slice(0, 10);

export async function windowStart(dir: string, date: string): Promise<string> {
  const names = await readdir(dir).catch((): string[] => []);

  const days = names.flatMap((f) => {
    const d = /^(\d{4}-\d{2}-\d{2})\.json$/u.exec(f)?.[1];

    return d !== undefined && d !== "" && d < date ? [d] : [];
  });

  const last = days.toSorted().at(-1);

  if (last === undefined) {
    return daysBefore(date, 3);
  }

  return last < daysBefore(date, 14) ? daysBefore(date, 14) : last;
}

function baseFacts(s: BillStatus, events: BillEvent[], since: string): BaseFacts {
  const closest = events.reduce<{ event: BillEvent; tally: Tally } | null>(
    (best, e) =>
      e.tally !== null && (!best || margin(e.tally) < margin(best.tally)) ? { event: e, tally: e.tally } : best,
    null,
  );

  const before = beforeFloor(s);
  const clock = voteClock(s, events);
  const firstVote = events.filter((e) => e.tally !== null).toSorted((a, b) => a.date.localeCompare(b.date))[0] ?? null;

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
      closestVoteUrl: closest?.event.url ?? null,
      closestVoteOn: closest ? voteQuestion(closest.event.text) : null,
      firstVote,
      clock,
      news: null,
      riders: null,
      xray: null,
    },
  };
}

export function candidate(s: BillStatus, since: string, published?: Map<string, string>, seen = new Set<string>()) {
  const events = billEvents(s, since, published);
  const unseen = events.filter((e) => !seen.has(e.id));

  if (!unseen.length) {
    return null;
  }

  const introduced = s.introducedOn ?? "";
  const start = introduced !== "" && introduced < since ? introduced : since;
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

export async function enrich(c: Candidate, cache: string, signal?: AbortSignal): Promise<string[]> {
  const id = c.status.id;
  const problems: string[] = [];

  try {
    c.evidence.news = await newsCount(c.status, today(), cache, signal);
    c.facts.newsStories = c.evidence.news.stories;
  } catch (error) {
    problems.push(`${billDisplay(id)} news count: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    await textFacts(c, join(cache, "text"), signal);
  } catch (error) {
    problems.push(`${billDisplay(id)} text: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const { confirmed, checked, searched, urls } = await lobbyingFilings(id, signal);
    c.facts.lobbyingFilings = confirmed;
    c.evidence.lobbyingFrom = "lda-checked";
    c.evidence.lobbyingChecked = { checked, searched };
    c.evidence.lobbyingUrls = urls;
  } catch (error) {
    problems.push(`${billDisplay(id)} lobbying check: ${error instanceof Error ? error.message : String(error)}`);
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

export const toXray = (cs: Candidate[], n: number, max?: number) => flaggedOf(rank(cs), max).slice(0, n);

// oxlint-disable-next-line unicorn/no-array-sort -- rank orders the caller's array in place; watch and sweep read candidates in that order afterwards
export const rank = (cs: Candidate[]) => cs.sort((a, b) => b.score - a.score || a.status.id.localeCompare(b.status.id));

function applyXray(c: Candidate, x: XrayFacts) {
  c.evidence.xray = x;

  if (x.lateSections) {
    c.facts.lateSections = x.lateSections.length;
    c.evidence.lateFrom = "x-ray";
  }

  if (x.deficit) {
    c.facts.deficitMusd = x.deficit.musd;
  }

  if (x.lobbying) {
    c.facts.lobbyingFilings = x.lobbying.filings;
    c.evidence.lobbyingFrom = "x-ray";
    c.evidence.lobbyingClients = x.lobbying.clients;
  }

  if (x.buried) {
    c.facts.buriedSections = x.buried.length;
  }

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

  for (const s of found.sources) {
    if (!s.ok) {
      problems.push(`${s.name}: ${s.error}`);
    }
  }

  if (found.sources.every((s) => !s.ok)) {
    throw new Error("every discovery source failed");
  }

  log(
    `${found.bills.size} bills touched (${found.sources.filter((s) => s.ok).length}/${found.sources.length} sources)`,
  );

  const seen = await reportedBefore(date);
  const failed: string[] = [];
  let unpublished = 0;

  const statuses = await pool([...found.bills], 6, async ([id, lastmod]) => {
    const stamp = (lastmod ?? date).replaceAll(/[^0-9T]/gu, "");

    try {
      return parseBillStatus(
        await cachedText(billstatusUrl(id), join(dir, "cache", "billstatus", `${id}@${stamp}.xml`), { signal }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.startsWith("404 ")) {
        unpublished++;
      } else {
        failed.push(`${id}: ${message}`);
      }

      return null;
    }
  });

  if (unpublished) {
    log(`${unpublished} new bills have text but no BILLSTATUS yet`);
  }

  if (failed.length) {
    problems.push(`BILLSTATUS unreadable for ${failed.length} bills: ${failed.slice(0, 5).join("; ")}`);
  }

  let alreadyReported = 0;
  const candidates: Candidate[] = [];

  for (const s of statuses) {
    if (!s) {
      continue;
    }

    for (const c of found.cbo.get(s.id) ?? []) {
      if (!s.cbo.some((x) => x.url === c.url)) {
        s.cbo.push(c);
      }
    }

    const c = candidate(s, actionsSince, found.published, seen);

    if (c) {
      candidates.push(c);
    } else if (billEvents(s, actionsSince, found.published).length) {
      alreadyReported++;
    }
  }

  log(`${candidates.length} moved with new events (${alreadyReported} already reported)`);

  await measureSize(candidates, signal);
  await readRiders(candidates, join(dir, "cache", "text"), signal);
  const shortlist = rank(candidates).slice(0, cfg.enrich);
  log(`enriching the top ${shortlist.length}: bill text, news, lobbying, x-ray tables`);

  for (const c of shortlist) {
    problems.push(...(await enrich(c, join(dir, "cache"), signal)));
  }

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

export async function readRiders(candidates: Candidate[], cache: string, signal?: AbortSignal) {
  await pool(
    candidates.filter((c) => isSpecialRule(c.status)),
    6,
    async (c) => {
      const v = c.evidence.newest;

      if (!v) {
        return;
      }

      c.evidence.riders = await cachedText(v.xmlUrl, join(cache, `${v.xmlUrl.split("/").pop()}`), { signal })
        .then(ruleRiders)
        .catch(() => c.evidence.riders);
    },
  );
}

export async function measureSize(candidates: Candidate[], signal?: AbortSignal) {
  await pool(candidates, 8, async (c) => {
    const url = c.evidence.newest?.xmlUrl;

    if (url === undefined || url === "" || c.facts.words !== null) {
      return;
    }

    const res = await get(url, { method: "HEAD", signal }).catch(() => null);

    if (!res) {
      return;
    }

    const bytes = Number(res.headers.get("content-length"));

    if (bytes) {
      c.facts.words = wordsFromBytes(bytes);
    }

    rescore(c);
  });
}

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

    if (!c.xray.ok) {
      problems.push(`x-ray ${billDisplay(id)} failed: ${c.xray.error} (log ${c.xray.log})`);
    }

    let facts = await xrayFacts(id);

    if (c.xray.ok && (facts.bundle ?? "") === "") {
      problems.push(`x-ray ${billDisplay(id)} finished but wrote no bundle (log ${c.xray.log})`);
    }

    if (settings().publish && c.xray.ok && (facts.bundle ?? "") !== "") {
      let problem: string | null;

      try {
        problem = await publishBundle(id);
      } catch (error) {
        problem = `${billDisplay(id)} bundle not published: ${error instanceof Error ? error.message : String(error)}`;
      }

      if (problem === null || problem === "") {
        site.published.push(id);
      } else {
        problems.push(problem);
      }

      facts = await xrayFacts(id);
    }

    applyXray(c, facts);
    xrayed.push(id);
  }

  return xrayed;
}

async function textFacts(c: Candidate, cache: string, signal?: AbortSignal) {
  const { newest, before } = c.evidence;

  if (!newest) {
    return;
  }

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

async function reportedBefore(date: string): Promise<Set<string>> {
  const shards = (await readdir(paths.table("watch_events")).catch((): string[] => []))
    .filter((f) => f.endsWith(".jsonl") && f !== `${date}.jsonl`)
    .map((f) => f.slice(0, -".jsonl".length));

  const rows = await Promise.all(shards.map(async (s) => await readRows("watch_events", s)));

  return new Set(rows.flat().map((e) => e.id));
}

export async function recordEvents(r: WatchResult, flagged: Candidate[]) {
  const seenAt = r.generatedAt;
  const rows = new Map((await readRows("watch_events", r.date)).filter((e) => e.kind !== "hot").map((e) => [e.id, e]));

  for (const c of r.candidates) {
    for (const e of c.events) {
      if (c.fresh.has(e.id) && !rows.has(e.id)) {
        rows.set(e.id, {
          id: e.id,
          bill_id: e.bill,
          kind: e.kind,
          seen_at: seenAt,
          url: e.url,
          detail: { step: e.step, date: e.date, text: e.text, tally: e.tally },
        });
      }
    }
  }

  for (const c of [...flagged, ...withRiders(r.candidates)]) {
    const riders = c.evidence.riders ?? [];
    rows.set(`${c.status.id}/hot/${r.date}`, {
      id: `${c.status.id}/hot/${r.date}`,
      bill_id: c.status.id,
      kind: "hot",
      seen_at: seenAt,
      url: links(c).page ?? congressGovUrl(c.status.id),
      detail: {
        display: billDisplay(c.status.id),
        title: c.status.shortTitle ?? c.status.title,
        sponsorParty: (c.status.sponsor?.party ?? "") === "" ? null : (c.status.sponsor?.party ?? null),
        reason:
          riders.length > 0
            ? `A House rule that also: ${[...new Set(riders.map((x) => x.label.toLowerCase()))].join("; ")}`
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
  }

  await writeRows("watch_events", r.date, [...rows.values()]);
}
