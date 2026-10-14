import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Row, Stage, StageContext } from "@antibody/core";
import { readRows, writeRows } from "@antibody/core/node";
import { fetchHousePdfs, type HouseFiling, houseIndex, parseHouse, pdfPath, years } from "./house.ts";
import { buildRows } from "./rows.ts";
import { fetchPaperImages, fetchSenate, imageDir, type SenateReport } from "./senate.ts";
import { cachedPages, prepare, readPages, type VisionJob } from "./vision.ts";

export { buildRows } from "./rows.ts";
export { parseSenatePtr } from "./senate.ts";
export { VISION_MODEL } from "./vision.ts";

const SENATE_SINCE = "01/01/2019";

/** Pages a single run may send to the vision model; the daily run keeps up with new paper filings within it. */
const visionBudget = () => Number(process.env.ANTIBODY_VISION_PAGES ?? 200);
/** Only filings on or after this date go to the vision model (ISO); unset reads every year, newest first. */
const visionSince = () => process.env.ANTIBODY_VISION_SINCE ?? "";

interface Scanned {
  doc: string;
  filed: string;
  src: (page: number) => string;
  perImage: boolean;
  pages: number;
}

/** Filings by members who sponsored or cosponsored a bill already ingested come first: those are the trades the bill pages show. */
async function priorityDocs(): Promise<Set<string>> {
  const involved = new Set((await readRows("sponsorships")).map((s) => s.bioguide));
  return new Set(
    (await readRows("ptr_documents")).filter((d) => d.bioguide && involved.has(d.bioguide)).map((d) => d.id),
  );
}

/** Every page of every scanned filing not yet read: priority members' filings first, then newest first. */
async function unreadPages(house: HouseFiling[], pagesOf: (docId: string) => number, senate: SenateReport[]) {
  const scanned: Scanned[] = house
    .filter((f) => f.scanned)
    .map((f) => ({
      doc: `h-${f.docId}`,
      filed: f.filed,
      src: () => pdfPath(f),
      perImage: false,
      pages: pagesOf(f.docId),
    }));
  for (const r of senate.filter((r) => r.kind === "paper")) {
    const images = (await readdir(imageDir(r.id)).catch(() => [] as string[])).filter((f) => f.endsWith(".gif"));
    scanned.push({
      doc: `s-${r.id}`,
      filed: r.filed,
      src: (p) => join(imageDir(r.id), `${p}.gif`),
      perImage: true,
      pages: images.length,
    });
  }
  const time = (d: string) => Date.parse(d) || 0;
  const since = visionSince() ? Date.parse(visionSince()) : 0;
  const priority = await priorityDocs();
  const rank = (s: Scanned) => (priority.has(s.doc) ? 1 : 0);
  scanned.sort((a, b) => rank(b) - rank(a) || time(b.filed) - time(a.filed));
  const jobs: (VisionJob & { s: Scanned })[] = [];
  for (const s of scanned) {
    if (time(s.filed) < since) continue;
    const done = new Set(await cachedPages(s.doc));
    for (let p = 1; p <= s.pages; p++) if (!done.has(p)) jobs.push({ doc: s.doc, page: p, s });
  }
  return jobs;
}

export async function ingestTrades(ctx: Pick<StageContext, "log" | "refresh">) {
  const house = await houseIndex(years(), ctx.refresh);
  const failed = await fetchHousePdfs(house, ctx.log);
  if (failed.length) ctx.log(`House PDFs failed: ${failed.join(", ")}`);
  const parsed = await parseHouse(house, false, ctx.log);
  const { reports, blocked } = await fetchSenate(SENATE_SINCE, ctx.log);
  if (blocked.length) ctx.log(`Senate pages blocked: ${blocked.join(", ")}`);
  await fetchPaperImages(reports);

  const budget = visionBudget();
  const unread = await unreadPages(house, (id) => parsed.get(id)?.pages ?? 0, reports);
  const batch = unread.slice(0, budget);
  ctx.log(`vision: ${unread.length} scanned pages unread, reading ${batch.length} now`);
  for (const j of batch) await prepare(j.doc, j.s.src(j.page), j.s.perImage ? j.page : undefined);
  const { failed: visionFailed } = await readPages(batch, Number(process.env.ANTIBODY_VISION_WORKERS ?? 4), ctx.log);
  for (const f of visionFailed) ctx.log(`vision failed ${f.job.doc} p${f.job.page}: ${f.error}`);

  const built = await buildRows(house, parsed, reports);
  await writeSharded(built.documents, built.trades);
  const status = built.documents.reduce<Record<string, number>>(
    (m, d) => Object.assign(m, { [d.read_status]: (m[d.read_status] ?? 0) + 1 }),
    {},
  );
  ctx.log(
    `${built.documents.length} filings (${JSON.stringify(status)}), ${built.trades.length} trades, ${built.dropped.length} rows without a readable owner or type`,
  );
  return built;
}

const shardOf = (r: { id: string }, filed: string | null | undefined) =>
  `${r.id.startsWith("h-") ? "house" : "senate"}-${filed?.slice(0, 4) ?? "undated"}`;

async function writeSharded(documents: Row<"ptr_documents">[], trades: Row<"trades">[]) {
  const filedOf = new Map(documents.map((d) => [d.id, d.filed_on]));
  const group = <T extends { id: string }>(rows: T[], filed: (r: T) => string | null | undefined) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const k = shardOf(r, filed(r));
      const list = m.get(k) ?? [];
      list.push(r);
      m.set(k, list);
    }
    return m;
  };
  for (const [shard, rows] of group(documents, (d) => d.filed_on)) await writeRows("ptr_documents", shard, rows);
  for (const [shard, rows] of group(trades, (t) => filedOf.get(t.document_id))) await writeRows("trades", shard, rows);
}

export const stages: Stage[] = [
  {
    name: "trades",
    scope: "global",
    needs: [],
    writes: ["ptr_documents", "trades"],
    run: async (ctx) => void (await ingestTrades(ctx)),
  },
];
