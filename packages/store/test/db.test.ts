import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TABLES } from "@antibody/core";
import { loadTables, openDb } from "../src/db.ts";

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
