import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { type Row, TABLES } from "@antibody/core";
import { python } from "@antibody/core/node";
import { buildLines, reconcile } from "../src/lines.ts";
import type { Parsed } from "../src/parsed.ts";
import { scopeFromText, scopeRows } from "../src/scope.ts";
import { sectionIndex } from "../src/sections.ts";

const fixture = (name: string) => resolve(import.meta.dir, "fixtures", name);
const letter = (await Bun.file(fixture("fra-letter.json")).json()) as string[];
const uv = Bun.which("uv") !== null;
const PKG = resolve(import.meta.dir, "..");

test("a label's scope is what CBO's paragraph under that heading says: its first 'Title X of division Y'", () => {
  expect(scopeFromText(["Funding for the Internal Revenue Service and Related Agencies"], letter)).toMatchObject({
    division: "B",
    title: "II",
    page: 5,
    quote:
      "Title II of division B would rescind certain unobligated funds provided to the IRS and other agencies in section 10301 of the 2022 reconciliation act.",
  });
  expect(scopeFromText(["Rescission of Unobligated Balances"], letter)).toMatchObject({ division: "B", title: "I" });
  expect(scopeFromText(["Temporary Assistance for Needy Families"], letter)).toMatchObject({
    division: "C",
    title: "I",
  });
});

test("a label whose own paragraph names no division takes its parent heading's", () => {
  const own = "Supplemental Nutrition Assistance Program";
  expect(scopeFromText([own], letter)).toBeUndefined();
  expect(scopeFromText([own, "Work Requirements"], letter)).toMatchObject({ division: "C", title: null });
});

test("a label that matches no heading, or the pages of tables, gives no scope", () => {
  expect(scopeFromText(["Nonrecurring Expenses Fund"], letter)).toBeUndefined();
  expect(scopeFromText(["Interest on the Public Debt"], letter)).toBeUndefined();
});

const section = (id: string, path: string, heading: string) =>
  ({ id, history: { eh: { path, heading } } }) as unknown as Row<"sections">;
const fra = [
  section(
    "s251",
    "division:B/title:II/sec:251",
    "Rescission of certain balances made available to the Internal Revenue Service",
  ),
  section("s301", "division:C/title:I/sec:301", "Recalibration of the caseload reduction credit"),
  section("s302", "division:C/title:I/sec:302", "Pilot projects"),
  ...Array.from({ length: 9 }, (_, i) =>
    section(
      `s${311 + i}`,
      `division:C/title:II/sec:${311 + i}`,
      i === 2
        ? "Supplemental nutrition assistance program under the Food and Nutrition Act of 2008"
        : `Exemptions ${i}`,
    ),
  ),
];

// Fiscal Responsibility Act, CBO publication 59225, Table 4 (a sheet printed in billions)
test.skipIf(!uv)(
  "a sheet in billions is read in millions, joined through the letter's scope, and cites the conversion",
  async () => {
    const parsed = JSON.parse(await python(PKG, "cbo.py", ["xlsx", fixture("fra-table4.xlsx")])) as Parsed;
    const sheet = parsed.sheets[0]!;
    expect(sheet.unit).toBe("billions");
    expect(reconcile(parsed.sheets).failing).toEqual([]);
    const programs = sheet.rows.filter((r) => r.line_kind === "program" && r.measure_kind === "outlays");
    expect(programs.map((r) => [r.section_title, r.parent, r.values["2023-2033"]])).toEqual([
      ["Funding for the Internal Revenue Service and Related Agencies", null, -1400],
      ["Supplemental Nutrition Assistance Program", "Work Requirements", 2100],
      ["Temporary Assistance for Needy Families", null, 0],
      ["Rescission of Unobligated Balances", null, -11000],
    ]);
    expect(parsed.summary?.rows.map((r) => [r.measure, r.values["2023-2033"]])).toEqual([
      ["Estimated Budget Authority", -26400],
      ["Estimated Outlays", -10300],
      ["Effect on the Deficit", -7900],
    ]);

    scopeRows(parsed.sheets, letter);
    const index = sectionIndex(fra, null);
    const src = {
      estimateId: "118-hr-3746.cbo-59225",
      billId: "118-hr-3746",
      fileUrl: "https://www.cbo.gov/system/files/2023-05/Table-4-hr3746.xlsx",
      archiveUrl: null,
      pdfUrl: null,
      pdfArchiveUrl: null,
    };
    const { lines } = buildLines(src, parsed, null, index.join, index.places);
    for (const l of lines) expect(TABLES.cbo_lines.schema.safeParse(l).error).toBeUndefined();

    const irs = lines.filter((l) => l.section_ids[0] === "s251" && l.line_kind === "section");
    expect(irs.map((l) => [l.measure, l.total_musd, l.join, l.split])).toEqual([
      ["budget_authority", -1400, "title", "exact"],
      ["outlays", -1400, "title", "exact"],
      ["revenues", -2300, "title", "exact"],
      ["deficit", 900, "title", "exact"],
    ]);
    expect(irs[0]?.source_locator).toContain(
      "CBO prints this sheet in billions of dollars; shown here in millions (x 1,000)",
    );
    expect(irs[0]?.source_locator).toContain("CBO's text says (page 5) \"Title II of division B would rescind");

    const snap = lines.find((l) => l.title === "Supplemental Nutrition Assistance Program" && l.measure === "outlays")!;
    expect(snap).toMatchObject({ line_kind: "group", section_ids: [], total_musd: 2100 });
    expect(snap.source_locator).toContain("more than 8 sections");
    expect(lines.some((l) => l.line_kind === "section" && l.total_musd === 2100)).toBe(false);
  },
);
