import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { paths } from "@antibody/core/node";
import { parseBillStatus } from "./billstatus.ts";
import type { BillStatus } from "./billstatus.ts";
import { WATCHED_TYPES } from "./discover.ts";
import type { SourceReport } from "./discover.ts";
import { STEPS } from "./events.ts";
import { get } from "./http.ts";
import { congressYears } from "./lda.ts";
import type { Site } from "./site.ts";
import { candidate, enrich, measureSize, rank, readRiders, settings, toXray, xrayAndPublish } from "./watch.ts";
import type { Candidate, WatchResult } from "./watch.ts";

export const congressStart = (congress: number) => `${congressYears(congress)[0]}-01-03`;

const bulkUrl = (congress: number, type: string) =>
  `https://www.govinfo.gov/bulkdata/BILLSTATUS/${congress}/${type}/BILLSTATUS-${congress}-${type}.zip`;

async function fresh(file: string, congress: number, today: string): Promise<boolean> {
  const s = await stat(file).catch(() => null);

  if (!s) {
    return false;
  }

  const finished = today >= `${congressYears(congress)[1] + 1}-01-03`;

  return finished || s.mtime.toLocaleDateString("en-CA") === today;
}

export async function bulkStatuses(
  congress: number,
  dir: string,
  today: string,
  signal?: AbortSignal,
): Promise<{ statuses: BillStatus[]; sources: SourceReport[] }> {
  const statuses: BillStatus[] = [];
  const sources: SourceReport[] = [];

  for (const type of WATCHED_TYPES) {
    const url = bulkUrl(congress, type);
    const zip = join(dir, `BILLSTATUS-${congress}-${type}.zip`);
    const out = join(dir, String(congress), type);

    try {
      if (!(await fresh(zip, congress, today))) {
        await mkdir(dir, { recursive: true });
        await Bun.write(zip, await (await get(url, { signal })).arrayBuffer());
        await Bun.$`rm -rf ${out}`.quiet();
      }

      if (!(await stat(out).catch(() => null))) {
        await mkdir(out, { recursive: true });
        await Bun.$`unzip -qo ${zip} -d ${out}`.quiet();
      }

      const files = (await readdir(out)).filter((f) => f.endsWith(".xml"));

      for (const f of files) {
        statuses.push(parseBillStatus(await Bun.file(join(out, f)).text()));
      }

      sources.push({
        name: `GovInfo bulk BILLSTATUS (${congress} ${type})`,
        url,
        ok: true,
        items: files.length,
        error: null,
      });
    } catch (error) {
      sources.push({
        name: `GovInfo bulk BILLSTATUS (${congress} ${type})`,
        url,
        ok: false,
        items: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { statuses, sources };
}

export const CONTESTED_SHARE = 0.1;

export function sweepShortlist(candidates: Candidate[], n: number): Candidate[] {
  const enacted = candidates.filter((c) => STEPS[c.facts.step].weight >= STEPS.enrolled.weight);

  const contested = candidates.filter((c) => {
    const v = c.facts.closestVote;

    return !!v && Math.min(v.yeas, v.nays) / (v.yeas + v.nays) >= CONTESTED_SHARE;
  });

  return [...new Set([...rank(candidates).slice(0, n), ...enacted, ...contested])];
}

export async function sweep(congress: number, log: (m: string) => void, signal?: AbortSignal): Promise<WatchResult> {
  const cfg = settings();
  const dir = paths.raw("watch");
  const date = new Date().toLocaleDateString("en-CA");
  const since = congressStart(congress);
  const problems: string[] = [];
  const { statuses, sources } = await bulkStatuses(congress, join(dir, "cache", "bulk"), date, signal);

  for (const s of sources) {
    if (!s.ok) {
      problems.push(`${s.name}: ${s.error}`);
    }
  }

  if (!statuses.length) {
    throw new Error(`no BILLSTATUS read for the ${congress}th Congress`);
  }

  const candidates = statuses.map((s) => candidate(s, since)).filter((c): c is Candidate => !!c);
  log(`${statuses.length} bills in the ${congress}th Congress, ${candidates.length} with floor or committee action`);

  await measureSize(candidates, signal);
  await readRiders(candidates, join(dir, "cache", "text"), signal);
  const shortlist = sweepShortlist(candidates, cfg.enrich);
  log(
    `enriching ${shortlist.length} (the top ${cfg.enrich}, every enacted bill and every contested vote): bill text, news, lobbying, x-ray tables`,
  );

  for (const c of shortlist) {
    problems.push(...(await enrich(c, join(dir, "cache"), signal)));
  }

  const site: Site = { published: [], deploy: { status: "pending" } };

  const picks = toXray(candidates, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
    .filter((c) => c.evidence.xray?.published !== true)
    .slice(0, cfg.xrays);

  const xrayed = await xrayAndPublish(
    picks,
    join(dir, "logs", `sweep-${congress}-${date}`),
    site,
    problems,
    log,
    signal,
  );

  rank(candidates);

  return {
    date,
    since,
    actionsSince: since,
    generatedAt: new Date().toISOString(),
    sources,
    candidates,
    alreadyReported: 0,
    xrayed,
    site,
    problems,
    sweep: congress,
  };
}
