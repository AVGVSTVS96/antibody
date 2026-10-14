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

test("bills owns the LLM counterparts; amendment rows name a committee sponsor and each section's effect", () => {
  expect(TABLES.counterparts.owner).toBe("@antibody/ingest-bills");
  expect(Object.fromEntries(columns("amendments")).sponsor_committee).toBe("VARCHAR");
  expect(Object.fromEntries(columns("amendment_sections")).effect).toBe("VARCHAR NOT NULL");
});

test("cbo lines name their spending kind and estimates keep the PDF they quote", () => {
  const line = {
    id: "119-s-1582.cbo-61551:bill:outlays:discretionary",
    estimate_id: "119-s-1582.cbo-61551",
    bill_id: "119-s-1582",
    line_kind: "whole-bill",
    section_nums: [],
    section_ids: [],
    title: null,
    measure: "outlays",
    spending: "discretionary",
    period: "2025-2030",
    total_musd: 0,
    values: { "2025-2030": 0 },
    split: "exact",
    archive_url: null,
    rests_on: [],
    source_url: "https://www.cbo.gov/system/files/2025-07/s1582.pdf",
    source_locator: "page 1, At a Glance",
  };
  expect(TABLES.cbo_lines.schema.safeParse(line).success).toBe(true);
  expect(TABLES.cbo_lines.schema.safeParse({ ...line, spending: "other" }).success).toBe(false);
  expect(Object.fromEntries(columns("cbo_estimates")).pdf_url).toBe("VARCHAR");
});
