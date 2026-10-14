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
  expect(Object.fromEntries(columns("lda_lobbyists")).named_members).toBe("VARCHAR[] NOT NULL");
});

test("members carry dated terms; FEC money splits contributions, outside spending and employer sums", () => {
  const cols = Object.fromEntries(columns("members"));
  expect(cols.terms).toBe("JSON[] NOT NULL");
  const member = {
    id: "S001191",
    name: "Kyrsten Sinema",
    party: "I",
    state: "AZ",
    district: null,
    chamber: "Senate",
    fec_candidate_ids: ["S8AZ00197"],
    lis_id: "S404",
    terms: [
      {
        chamber: "Senate",
        start: "2019-01-03",
        end: "2022-12-08",
        state: "AZ",
        district: null,
        party: "Democrat",
        caucus: null,
      },
      {
        chamber: "Senate",
        start: "2022-12-09",
        end: "2025-01-03",
        state: "AZ",
        district: null,
        party: "Independent",
        caucus: "Democrat",
      },
    ],
    source_url: "https://bioguide.congress.gov/search/bio/S001191",
    source_locator: null,
  };
  expect(TABLES.members.schema.safeParse(member).success).toBe(true);
  expect(Object.fromEntries(columns("employer_contributions")).committee_ids).toBe("VARCHAR[] NOT NULL");
  expect(TABLES.independent_expenditures.owner).toBe("@antibody/ingest-fec");
  expect(TABLES.employer_contributions.owner).toBe("@antibody/ingest-fec");
});
