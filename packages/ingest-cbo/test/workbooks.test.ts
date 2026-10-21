import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { python } from "@antibody/core/node";
import type { Parsed, ParsedRow } from "../src/parsed.ts";

const PKG = resolve(import.meta.dir, "..");
const uv = Bun.which("uv") !== null;

// American Rescue Plan Act, CBO publication 57056: rows excerpted from four committees' sheets of
// Estimated_Budgetary_Effects_of_hr1319_detailed_tables.xlsx, each laid out differently
const parsed = uv
  ? (JSON.parse(
      await python(PKG, "cbo.py", ["xlsx", resolve(import.meta.dir, "fixtures", "arpa-titles.xlsx")]),
    ) as Parsed)
  : null;
const sheet = (name: string) => parsed!.sheets.find((s) => s.sheet === name)!.rows;
const amount = (rows: ParsedRow[], num: string, kind: string, year = "2021-2031") =>
  rows.find((r) => r.line_kind === "section" && r.sections.includes(num) && r.measure_kind === kind)?.values[year];

test.skipIf(!uv)("every title sheet is read, whichever column CBO starts its numbers in", () => {
  expect(parsed!.sheets.map((s) => s.sheet)).toEqual(["Title 1.", "Title 4.", "Title 8.", "Title 9."]);
  for (const s of parsed!.sheets) expect(s.years.at(-1)).toBe("2021-2031");
});

test.skipIf(!uv)("'Sec. 1001 - Title' in one cell is a section row, and its title can wrap into the next row", () => {
  const rows = sheet("Title 1.");
  expect(amount(rows, "1001", "outlays")).toBe(4000);
  expect(rows.find((r) => r.sections.includes("1006"))?.section_title).toBe(
    "USDA Assistance and Support for Socially Disadvantaged Farmers, Ranchers, Forest Land Owners and Operators, and Groups",
  );
});

test.skipIf(!uv)("a blank column between the years and the totals doesn't shift the totals", () => {
  const rows = sheet("Title 4.");
  expect(amount(rows, "4001", "outlays", "2021-2030")).toBe(430);
  expect(amount(rows, "4001", "budget_authority", "2021-2031")).toBe(570);
  expect(amount(rows, "4004", "outlays")).toBe(13);
});

test.skipIf(!uv)("measure labels in column A, under 'Sec. 8001  Title', belong to that section", () => {
  expect(amount(sheet("Title 8."), "8002", "outlays")).toBe(14088);
});

test.skipIf(!uv)("Finance's sheet: 'Sec.', number and title in columns C to E, and numbers from column G", () => {
  const rows = sheet("Title 9.");
  expect(Math.round(amount(rows, "9704", "outlays")!)).toBe(83304);
  expect(amount(rows, "9901", "outlays")).toBe(362050);
  expect(rows.find((r) => r.sections.includes("9704"))?.section_title).toBe("Multiemployer Pension Plans");
  expect(rows.find((r) => r.section_title === "Total Increase in Direct Spending")?.line_kind).toBe("total");
});

test.skipIf(!uv)(
  "revenue rows: On-budget and Off-budget are parts of the Total, and a lone On-budget row is the whole",
  () => {
    const rows = sheet("Title 9.");
    const network = rows.filter((r) => r.sections.includes("9674") && r.block === "revenues");
    expect(network.map((r) => [r.measure_kind, r.values["2021-2031"]])).toEqual([
      ["on_budget_revenues", 4827],
      ["off_budget_revenues", 4018],
      ["revenues", 8845],
    ]);
    expect(amount(rows, "9704", "revenues")).toBe(2069);
  },
);
