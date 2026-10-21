import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TABLES } from "@antibody/core";
import { loadTables, openDb, query } from "../src/db.ts";

const dir = await mkdtemp(join(tmpdir(), "antibody-store-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

test("every contract table creates in DuckDB and loads JSONL shards", async () => {
  const trade = {
    id: "20032256#1",
    document_id: "20032256",
    bioguide: "M001236",
    filer_name: "Hon. Tim Moore",
    chamber: "House",
    owner: "self",
    asset: "Coinbase Global, Inc. - Class A Common Stock (COIN) [ST]",
    asset_type: "ST",
    ticker: "COIN",
    type: "purchase",
    traded_on: "2025-09-11",
    notified_on: null,
    amount: "$15,001 - $50,000",
    amount_min: 15001,
    amount_max: 50000,
    page: 1,
    read_by: "text",
    confidence: 1,
    needs_second_read: false,
    raw: { filing_status: "New" },
    source_url: "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2025/20032256.pdf",
    source_locator: "page 1",
  };
  TABLES.trades.schema.parse(trade);
  await Bun.write(join(dir, "trades", "2025.jsonl"), `${JSON.stringify(trade)}\n`);

  const db = await openDb(":memory:");
  const counts = await loadTables(db, (t) => join(dir, t));
  expect(counts.trades).toBe(1);
  expect(counts.bills).toBe(0);
  const row = (await db.runAndReadAll("SELECT owner, traded_on::VARCHAR, raw->>'filing_status' FROM trades")).getRows();
  expect(row).toEqual([["self", "2025-09-11", "New"]]);
});

test("a repeated id is skipped and a table that breaks its constraints stays empty, both reported", async () => {
  const row = {
    id: "C00364778",
    name: "BANK OF AMERICA CORPORATION FEDERAL PAC",
    connected_org: null,
    type: "Q",
    designation: "B",
    source_url: "https://www.fec.gov/data/committee/C00364778/",
    source_locator: null,
  };
  TABLES.pacs.schema.parse(row);
  await Bun.write(join(dir, "pacs", "a.jsonl"), `${JSON.stringify(row)}\n${JSON.stringify(row)}\n`);
  const seen: string[] = [];
  const db = await openDb(":memory:");
  const report = (t: string, problem: string) => seen.push(`${t}: ${problem}`);
  expect((await loadTables(db, (t) => join(dir, t), report)).pacs).toBe(1);
  expect(seen).toEqual(["pacs: 1 duplicate ids skipped, e.g. C00364778"]);

  await Bun.write(join(dir, "pacs", "b.jsonl"), `${JSON.stringify({ ...row, id: "C1", name: null })}\n`);
  seen.length = 0;
  expect((await loadTables(db, (t) => join(dir, t), report)).pacs).toBe(0);
  expect(seen[0]).toStartWith("pacs: not loaded: Constraint Error");
});

test("query returns rows shaped like their JSONL: JSON and JSON[] parsed, BIGINT as number, dates as strings", async () => {
  const db = await openDb(":memory:");
  await db.run(`CREATE TABLE t (n BIGINT, d DATE, j JSON, js JSON[])`);
  await db.run(`INSERT INTO t VALUES (5, '2025-07-18', '{"a":1}', ['{"start":"2025-01-03"}'])`);
  expect(await query(db, "SELECT * FROM t WHERE list_contains($ids, n)", { ids: [5] })).toEqual([
    { n: 5, d: "2025-07-18", j: { a: 1 }, js: [{ start: "2025-01-03" }] },
  ]);
});

test("a shard written before an additive column existed loads with the column's default", async () => {
  const row = {
    id: "119-hr-1:s1",
    bill_id: "119-hr-1",
    section_id: "s1",
    label: "normal",
    buried: null,
    dollars_musd: null,
    dollars_split: null,
    attention_pct: 0.5,
    late: false,
    off_topic: null,
    lobbying_reports: 0,
    rule: "buried-v4",
    confidence: 0.7,
    rests_on: ["sections/s1"],
    evidence: {},
  };
  await Bun.write(join(dir, "section_scores", "old.jsonl"), `${JSON.stringify(row)}\n`);
  const db = await openDb(":memory:");
  expect((await loadTables(db, (t) => join(dir, t))).section_scores).toBe(1);
  const [r] = await query(db, "SELECT reach, lobbying_firms, late_cleared_by FROM section_scores");
  expect(r).toEqual({ reach: [], lobbying_firms: 0, late_cleared_by: null });
});
