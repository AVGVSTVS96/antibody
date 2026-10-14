import { exists, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { heavy, paths } from "@antibody/core/node";
import { download, pool } from "./http.ts";

export const FIRST_YEAR = 2019;
const CLERK = "https://disclosures-clerk.house.gov/public_disc";

export interface HouseFiling {
  docId: string;
  year: string;
  prefix: string;
  last: string;
  first: string;
  suffix: string;
  /** State + district as filed, e.g. "GA12" or "CA00" for at-large. */
  stateDst: string;
  filed: string;
  url: string;
  /** DocIDs starting 8 or 9 are scanned paper; 2xxxxxxx are e-filed with a text layer (100% agreement on 1,384 filings). */
  scanned: boolean;
}

export const houseRoot = () => paths.raw("trades");
export const pdfPath = (f: Pick<HouseFiling, "year" | "docId">) => join(houseRoot(), "house", f.year, `${f.docId}.pdf`);
export const ptrUrl = (year: string, docId: string) => `${CLERK}/ptr-pdfs/${year}/${docId}.pdf`;

export function years(from = FIRST_YEAR, to = new Date().getFullYear()) {
  return Array.from({ length: to - from + 1 }, (_, i) => String(from + i));
}

/** Fetches the Clerk's yearly ZIP index (always for the current year, once for past years) and returns its PTRs. */
export async function houseIndex(ys: string[], refresh = false): Promise<HouseFiling[]> {
  const idx = join(houseRoot(), "idx");
  await mkdir(idx, { recursive: true });
  const thisYear = String(new Date().getFullYear());
  const out: HouseFiling[] = [];
  for (const year of ys) {
    const txt = join(idx, `${year}FD.txt`);
    if (refresh || year === thisYear || !(await exists(txt))) {
      const zip = join(houseRoot(), `${year}FD.zip`);
      if (!(await download(`${CLERK}/financial-pdfs/${year}FD.zip`, zip)))
        throw new Error(`House index ${year} failed`);
      await heavy(["unzip", "-o", "-q", zip, `${year}FD.txt`, "-d", idx]);
    }
    out.push(...parseIndex(await Bun.file(txt).text()));
  }
  return out;
}

export function parseIndex(text: string): HouseFiling[] {
  const rows: HouseFiling[] = [];
  for (const line of text.replace(/^﻿/, "").trim().split(/\r?\n/).slice(1)) {
    const [prefix = "", last = "", first = "", suffix = "", type, stateDst = "", year = "", filed = "", rawId = ""] =
      line.split("\t");
    const docId = rawId.trim();
    if (type !== "P" || !docId) continue;
    rows.push({
      docId,
      year,
      prefix,
      last,
      first,
      suffix,
      stateDst,
      filed,
      url: ptrUrl(year, docId),
      scanned: /^[89]/.test(docId),
    });
  }
  return rows;
}

/** Downloads every filing PDF not already on disk. Returns the DocIDs that failed. */
export async function fetchHousePdfs(filings: HouseFiling[], log: (m: string) => void): Promise<string[]> {
  const missing: HouseFiling[] = [];
  for (const f of filings) if (!(await exists(pdfPath(f)))) missing.push(f);
  log(`House PDFs: ${filings.length} filings, ${missing.length} to download`);
  const failed: string[] = [];
  let done = 0;
  await pool(missing, 4, async (f) => {
    await mkdir(join(houseRoot(), "house", f.year), { recursive: true });
    if (!(await download(f.url, pdfPath(f)))) failed.push(f.docId);
    if (++done % 250 === 0) log(`  ${done}/${missing.length}`);
  });
  return failed;
}

export interface ParsedDoc {
  doc_id: string;
  year: string;
  pages: number | null;
  filer: string | null;
  trades: ParsedTrade[];
  error: string | null;
}

/** One row as the word-position parser reads it from an e-filed PDF; values are as filed. */
export interface ParsedTrade {
  page: number;
  filer: string | null;
  owner: string;
  asset: string;
  asset_type: string | null;
  ticker: string | null;
  type: string;
  date: string;
  notified: string;
  amount: string;
  details: Record<string, string>;
}

const PKG = join(import.meta.dir, "..");
const parsedFile = () => join(houseRoot(), "house-parsed.jsonl");

/** Parses every PDF not yet in data/trades/house-parsed.jsonl (pdfplumber word positions), and returns all docs. */
export async function parseHouse(filings: HouseFiling[], refresh: boolean, log: (m: string) => void) {
  const file = Bun.file(parsedFile());
  const docs = new Map<string, ParsedDoc>();
  if (!refresh && (await file.exists()))
    for (const line of (await file.text()).split("\n")) if (line) docs.set(JSON.parse(line).doc_id, JSON.parse(line));
  const todo = [];
  for (const f of filings) if (!docs.has(f.docId) && (await exists(pdfPath(f)))) todo.push(pdfPath(f));
  log(`House parse: ${docs.size} cached, ${todo.length} to parse`);
  if (todo.length) {
    const list = join(houseRoot(), "house-parse-todo.txt");
    await Bun.write(list, todo.join("\n"));
    const out = await heavy([
      "uv",
      "run",
      "-q",
      "--project",
      PKG,
      "python",
      "-I",
      join(PKG, "py/house_batch.py"),
      list,
    ]);
    for (const line of out.split("\n")) if (line) docs.set(JSON.parse(line).doc_id, JSON.parse(line));
    await Bun.write(parsedFile(), `${[...docs.values()].map((d) => JSON.stringify(d)).join("\n")}\n`);
  }
  return docs;
}
