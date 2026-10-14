import { expect, test } from "bun:test";
import { columns, ddl } from "../src/ddl.ts";
import { TABLE_NAMES, TABLES } from "../src/tables.ts";

test("every table has an owner package and an id column", () => {
  for (const t of TABLE_NAMES) {
    expect(TABLES[t].owner).toMatch(/^@antibody\//);
    expect(columns(t)[0]).toEqual(["id", "VARCHAR"]);
  }
});

test("nullable, list, date and json columns map to DuckDB types", () => {
  const cols = Object.fromEntries(columns("trades"));
  expect(cols.ticker).toBe("VARCHAR");
  expect(cols.owner).toBe("VARCHAR NOT NULL");
  expect(cols.traded_on).toBe("DATE");
  expect(cols.raw).toBe("JSON NOT NULL");
  expect(Object.fromEntries(columns("cbo_lines")).section_ids).toBe("VARCHAR[] NOT NULL");
  expect(ddl("members")).toContain("CREATE TABLE IF NOT EXISTS members");
});

test("rows are strict: an unknown column fails", () => {
  const ok = {
    id: "C00431312",
    name: "SIFMA PAC",
    connected_org: null,
    type: "Q",
    designation: "B",
    source_url: "https://www.fec.gov/data/committee/C00431312/",
    source_locator: null,
  };
  expect(TABLES.pacs.schema.safeParse(ok).success).toBe(true);
  expect(TABLES.pacs.schema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
});

test("lobbying: topic-only refs are inference rows, spend rows carry both facets", () => {
  const topic = {
    id: "u#0#119-s-1582",
    filing_id: "u",
    bill_id: "119-s-1582",
    line: 1,
    issue_code: "BAN",
    quote: "stablecoin legislation",
    topic: "payment stablecoins",
    phase: "bill",
    source_url: "https://lda.gov/filings/public/filing/u/print/",
    source_locator: "issue line 1 of 1",
    rule: "topic-only",
    confidence: 0.6,
    rests_on: ["lda_filings/u"],
    evidence: {},
  };
  expect(TABLES.lda_topic_refs.schema.safeParse(topic).success).toBe(true);
  expect(TABLES.lda_topic_refs.schema.safeParse({ ...topic, rests_on: [] }).success).toBe(false);
  const cols = Object.fromEntries(columns("lda_spend"));
  expect(cols.client_key).toBe("VARCHAR");
  expect(cols.total_rests_on).toBe("VARCHAR[] NOT NULL");
  expect(Object.fromEntries(columns("lda_filings")).period_end).toBe("DATE NOT NULL");
});
