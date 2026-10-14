import { readdir } from "node:fs/promises";
import type { Row } from "@antibody/core";
import type { HouseFiling, ParsedDoc } from "./house.ts";
import { memberMatcher } from "./members.ts";
import { amountRange, isoDate, owner, tradeType } from "./normalize.ts";
import { collapseRestated, type Filed } from "./restated.ts";
import { imageDir, pagePath, parseSenatePtr, type SenateReport } from "./senate.ts";
import { cachedPages, cachedRead, type FIELDS, type PageResult, type VisionRow } from "./vision.ts";

type Doc = Row<"ptr_documents">;
type Trade = Row<"trades">;

export interface Built {
  documents: Doc[];
  trades: Trade[];
  /** Rows a reader saw but could not store (no readable type or owner), per document. */
  dropped: { document: string; row: unknown; why: string }[];
}

const houseDocId = (docId: string) => `h-${docId}`;
const senateDocId = (uuid: string) => `s-${uuid}`;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

function amounts(amount: string) {
  const { min, max } = amountRange(amount);
  return { amount: clean(amount), amount_min: min, amount_max: max };
}

/**
 * A vision row after its recheck: a rechecked cell replaces the first reading only when the first had unreadable
 * characters ("_" or empty) and the recheck could read it. The row stays flagged either way.
 */
export function settle(r: VisionRow, index: number, page: PageResult) {
  const checks = page.recheck?.cells.filter((c) => c.row === index) ?? [];
  const values: Record<(typeof FIELDS)[number], string | null> = { ...r };
  const agreed = checks.every((c) => c.readable && c.value === (r[c.field] ?? ""));
  for (const c of checks) {
    const first = r[c.field] ?? "";
    if (c.readable && (first === "" || first.includes("_"))) values[c.field] = c.value;
  }
  const uncertain = r.uncertain.length > 0;
  return {
    values,
    confidence: !uncertain ? 0.9 : agreed && checks.length >= r.uncertain.length ? 0.75 : 0.5,
    flagged: uncertain,
    checks,
  };
}

function visionTrades(
  docId: string,
  base: { bioguide: string | null; filer_name: string; chamber: Trade["chamber"] },
  pages: PageResult[],
  sourceFor: (page: number) => { url: string; where: string },
  dropped: Built["dropped"],
): Trade[] {
  const out: Trade[] = [];
  for (const page of pages) {
    for (const [i, r] of page.read.rows.entries()) {
      const { values, confidence, flagged, checks } = settle(r, i, page);
      const own = owner(values.owner);
      const type = tradeType(values.type ?? "");
      if (!type && !values.date?.trim() && !values.amount?.trim()) continue;
      if (!own || !type) {
        dropped.push({ document: docId, row: r, why: !own ? `owner "${values.owner}"` : `type "${values.type}"` });
        continue;
      }
      const src = sourceFor(page.page);
      out.push({
        id: `${docId}-p${page.page}-${i + 1}`,
        document_id: docId,
        ...base,
        owner: own,
        asset: clean(values.asset ?? ""),
        asset_type: null,
        ticker: values.ticker?.trim() || null,
        type,
        traded_on: isoDate(values.date),
        notified_on: isoDate(values.notified),
        ...amounts(values.amount ?? ""),
        page: page.page,
        read_by: "vision",
        confidence,
        needs_second_read: flagged,
        raw: {
          as_read: r,
          rechecked: checks,
          page_kind: page.read.page_kind,
          model: page.model,
          ...(r.note ? { note: r.note } : {}),
        },
        source_url: src.url,
        source_locator: `${src.where}, row ${i + 1} (vision read${flagged ? ", uncertain cells" : ""})`,
      });
    }
  }
  return out;
}

async function visionPages(doc: string) {
  const pages: PageResult[] = [];
  for (const n of (await cachedPages(doc)).sort((a, b) => a - b)) {
    const read = await cachedRead(doc, n);
    if (read) pages.push(read);
  }
  return pages;
}

const readStatus = (read: number, total: number | null, dropped: boolean): Doc["read_status"] =>
  read === 0 ? "unread" : total !== null && read >= total && !dropped ? "read" : "partial";

export async function buildRows(house: HouseFiling[], parsed: Map<string, ParsedDoc>, senate: SenateReport[]) {
  const match = await memberMatcher();
  const built: Built = { documents: [], trades: [], dropped: [] };
  const amended = new Set<string>();

  for (const f of house) {
    const id = houseDocId(f.docId);
    const filed = isoDate(f.filed);
    const filer_name = clean(`${f.first} ${f.last} ${f.suffix}`);
    const base = { bioguide: match.house(f.last, f.first, f.stateDst, filed), filer_name, chamber: "House" as const };
    const doc = parsed.get(f.docId);
    const pages = doc?.pages ?? null;
    let read = 0;
    let lost = false;
    if (!f.scanned && doc && !doc.error) {
      read = pages ?? 1;
      const perPage = new Map<number, number>();
      for (const [k, t] of doc.trades.entries()) {
        const row = (perPage.get(t.page) ?? 0) + 1;
        perPage.set(t.page, row);
        const own = owner(t.owner);
        const type = tradeType(t.type);
        if (!own || !type) {
          built.dropped.push({ document: id, row: t, why: !own ? `owner "${t.owner}"` : `type "${t.type}"` });
          lost = true;
          continue;
        }
        built.trades.push({
          id: `${id}-${k + 1}`,
          document_id: id,
          ...base,
          owner: own,
          asset: clean(t.asset),
          asset_type: t.asset_type,
          ticker: t.ticker,
          type,
          traded_on: isoDate(t.date),
          notified_on: isoDate(t.notified),
          ...amounts(t.amount),
          page: t.page,
          read_by: "text",
          confidence: 1,
          needs_second_read: false,
          raw: { owner: t.owner, type: t.type, date: t.date, notified: t.notified, filer: t.filer, details: t.details },
          source_url: `${f.url}#page=${t.page}`,
          source_locator: `page ${t.page}, row ${row}`,
        });
      }
    } else if (f.scanned) {
      const vp = await visionPages(id);
      read = vp.length;
      const before = built.dropped.length;
      built.trades.push(
        ...visionTrades(id, base, vp, (p) => ({ url: `${f.url}#page=${p}`, where: `page ${p}` }), built.dropped),
      );
      lost = built.dropped.length > before;
    }
    if (doc?.trades.some((t) => t.details?.filing_status === "Amended")) amended.add(id);
    built.documents.push({
      id,
      chamber: "House",
      filer_name,
      bioguide: base.bioguide,
      filed_on: filed,
      url: f.url,
      pages,
      scanned: f.scanned,
      read_status: readStatus(read, pages, lost),
      read_by: read === 0 ? null : f.scanned ? "vision" : "text",
      source_url: f.url,
      source_locator: null,
    });
  }

  for (const r of senate) {
    const id = senateDocId(r.id);
    const filed = isoDate(r.filed);
    const last = r.office.includes(",") ? r.office.split(",")[0]! : r.last;
    const filer_name = clean(`${r.first} ${r.last}`).replace(/\b([A-Z])([A-Z]+)\b/g, (_, a, b) => a + b.toLowerCase());
    const base = { bioguide: match.senate(last, r.first, filed), filer_name, chamber: "Senate" as const };
    let pages: number | null = null;
    let read = 0;
    let lost = false;
    if (r.kind === "ptr") {
      const html = await Bun.file(pagePath(r.id))
        .text()
        .catch(() => null);
      if (html) {
        pages = 1;
        read = 1;
        for (const t of parseSenatePtr(html)) {
          const own = owner(t.owner);
          const type = tradeType(t.type);
          if (!own || !type) {
            built.dropped.push({ document: id, row: t, why: !own ? `owner "${t.owner}"` : `type "${t.type}"` });
            lost = true;
            continue;
          }
          built.trades.push({
            id: `${id}-${t.n}`,
            document_id: id,
            ...base,
            owner: own,
            asset: t.asset,
            asset_type: t.assetType || null,
            ticker: t.ticker,
            type,
            traded_on: isoDate(t.date),
            notified_on: null,
            ...amounts(t.amount),
            page: null,
            read_by: "html",
            confidence: 1,
            needs_second_read: false,
            raw: {
              owner: t.owner,
              type: t.type,
              date: t.date,
              ...(t.assetDetail ? { asset_detail: t.assetDetail } : {}),
              ...(t.comment ? { comment: t.comment } : {}),
            },
            source_url: r.url,
            source_locator: `transaction #${t.n}`,
          });
        }
      }
    } else {
      pages =
        (await readdir(imageDir(r.id)).catch(() => [] as string[])).filter((f) => f.endsWith(".gif")).length || null;
      const vp = await visionPages(id);
      read = vp.length;
      const before = built.dropped.length;
      built.trades.push(...visionTrades(id, base, vp, (p) => ({ url: r.url, where: `image ${p}` }), built.dropped));
      lost = built.dropped.length > before;
    }
    if (/\(Amendment/i.test(r.title)) amended.add(id);
    built.documents.push({
      id,
      chamber: "Senate",
      filer_name,
      bioguide: base.bioguide,
      filed_on: filed,
      url: r.url,
      pages,
      scanned: r.kind === "paper",
      read_status: readStatus(read, pages, lost),
      read_by: read === 0 ? null : r.kind === "paper" ? "vision" : "html",
      source_url: r.url,
      source_locator: null,
    });
  }
  const docs = new Map<string, Filed>(
    built.documents.map((d) => [d.id, { filedOn: d.filed_on ?? "", amended: amended.has(d.id) }]),
  );
  built.trades = collapseRestated(built.trades, docs);
  return built;
}
