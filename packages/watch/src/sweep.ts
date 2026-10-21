import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { BillId } from "@antibody/core";
import { paths } from "@antibody/core/node";
import { type BillStatus, parseBillStatus } from "./billstatus.ts";
import { type SourceReport, WATCHED_TYPES } from "./discover.ts";
import { get } from "./http.ts";
import { congressYears } from "./lda.ts";
import type { Site } from "./site.ts";
import {
  type Candidate,
  candidate,
  enrich,
  measureSize,
  rank,
  settings,
  toXray,
  type WatchResult,
  xrayAndPublish,
} from "./watch.ts";

/** The first day of a Congress: the 119th met on 2025-01-03. */
export const congressStart = (congress: number) => `${congressYears(congress)[0]}-01-03`;

const bulkUrl = (congress: number, type: string) =>
  `https://www.govinfo.gov/bulkdata/BILLSTATUS/${congress}/${type}/BILLSTATUS-${congress}-${type}.zip`;

/** A finished Congress's zip never changes; the current one's is fetched again once a day. */
async function fresh(file: string, congress: number, today: string): Promise<boolean> {
  const s = await stat(file).catch(() => null);
  if (!s) return false;
  const finished = today >= `${congressYears(congress)[1]! + 1}-01-03`;
  return finished || s.mtime.toLocaleDateString("en-CA") === today;
}

/** Every BILLSTATUS of one Congress, from GovInfo's bulk zip per bill type (about 55 MB for the 119th). */
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
      for (const f of files) statuses.push(parseBillStatus(await Bun.file(join(out, f)).text()));
      sources.push({
        name: `GovInfo bulk BILLSTATUS (${congress} ${type})`,
        url,
        ok: true,
        items: files.length,
        error: null,
      });
    } catch (e) {
      sources.push({
        name: `GovInfo bulk BILLSTATUS (${congress} ${type})`,
        url,
        ok: false,
        items: 0,
        error: String((e as Error).message ?? e),
      });
    }
  }
  return { statuses, sources };
}

/**
 * Scores every bill of a Congress on its whole record, not one window: the per-bill view the daily watch can't give,
 * since it only sees bills that moved since its last run. Enriches the best `enrich`, then x-rays and publishes the
 * flagged bills that have no page yet, at most `xrays`.
 */
export async function sweep(congress: number, log: (m: string) => void, signal?: AbortSignal): Promise<WatchResult> {
  const cfg = settings();
  const dir = paths.raw("watch");
  const date = new Date().toLocaleDateString("en-CA");
  const since = congressStart(congress);
  const problems: string[] = [];
  const { statuses, sources } = await bulkStatuses(congress, join(dir, "cache", "bulk"), date, signal);
  for (const s of sources) if (!s.ok) problems.push(`${s.name}: ${s.error}`);
  if (!statuses.length) throw new Error(`no BILLSTATUS read for the ${congress}th Congress`);
  const candidates = statuses.map((s) => candidate(s, since)).filter((c): c is Candidate => !!c);
  log(`${statuses.length} bills in the ${congress}th Congress, ${candidates.length} with floor or committee action`);

  await measureSize(candidates, signal);
  const shortlist = rank(candidates).slice(0, cfg.enrich);
  log(`enriching the top ${shortlist.length}: bill text, news, lobbying, x-ray tables`);
  for (const c of shortlist) problems.push(...(await enrich(c, join(dir, "cache"), signal)));

  const site: Site = { published: [], deploy: { status: "pending" } };
  const picks = toXray(candidates, Number.POSITIVE_INFINITY)
    .filter((c) => !c.evidence.xray?.published)
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
    xrayed: xrayed as BillId[],
    site,
    problems,
    sweep: congress,
  };
}
