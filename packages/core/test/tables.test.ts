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
