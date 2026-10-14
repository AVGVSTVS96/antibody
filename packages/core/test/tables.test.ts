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

test("watch events cover votes, major actions and new CBO estimates", () => {
  const row = {
    id: "119-hr-1/floor_vote/2025-05-22/h-145",
    bill_id: "119-hr-1",
    kind: "floor_vote",
    seen_at: "2025-05-23T12:00:00Z",
    url: "https://clerk.house.gov/evs/2025/roll145.xml",
    detail: { yeas: 215, nays: 214 },
  };
  expect(TABLES.watch_events.schema.safeParse(row).success).toBe(true);
  for (const kind of ["action", "cbo_estimate", "hot"])
    expect(TABLES.watch_events.schema.safeParse({ ...row, kind }).success).toBe(true);
});
