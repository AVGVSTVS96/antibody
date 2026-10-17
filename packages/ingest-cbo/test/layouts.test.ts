import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { python } from "@antibody/core/node";
import { reconcile } from "../src/lines.ts";
import type { Parsed, ParsedRow } from "../src/parsed.ts";

const PKG = resolve(import.meta.dir, "..");
const parse = async (name: string) =>
  JSON.parse(await python(PKG, "cbo.py", ["pages", resolve(import.meta.dir, "fixtures", name)])) as Parsed;

const rowsOf = (p: Parsed) => p.sheets.flatMap((s) => s.rows);
const lineOf = (rows: ParsedRow[], pick: (r: ParsedRow) => boolean) => {
  const first = rows.find(pick)!;
  return rows.filter((r) => r.line === first.line && r.sheet === first.sheet);
};
const total = (rows: ParsedRow[], measure: string, year: string) =>
  rows.find((r) => r.measure_kind === measure)!.values[year];

const parsers = Bun.which("uv") !== null;

// CHIPS and Science, CBO publication 58319, Table 2 (pages 3-4 of hr4346_chip.pdf)
test.skipIf(!parsers)(
  "a table that prints 'Section N.' over wrapped titles reads one row per section, under its division",
  async () => {
    const rows = rowsOf(await parse("chips-table2.json"));
    const sections = rows.filter((r) => r.line_kind === "section" && r.measure_kind === "outlays");
    expect(sections.map((r) => [r.division, r.sections, r.values["2022-2031"]])).toEqual([
      ["A", ["102"], 50544],
      ["A", ["106"], 1400],
      ["B", ["10108", "10761"], 3050],
      ["B", ["10862"], 80],
    ]);
    expect(sections[0]?.section_title).toBe(
      "Creating Helpful Incentives to Produce Semiconductors (CHIPS) for America Fund",
    );
    expect(sections[2]?.section_title).toBe(
      "Science Laboratories Infrastructure Program and Applied Laboratories Infrastructure Restoration and Modernization",
    );
  },
);

test.skipIf(!parsers)(
  "a revenue row printed on the same line as its section title is that section's revenue, and the table reconciles",
  async () => {
    const parsed = await parse("chips-table2.json");
    const revenue = rowsOf(parsed).find((r) => r.block === "revenues" && r.line_kind === "section")!;
    expect(revenue).toMatchObject({
      division: "A",
      sections: ["107"],
      section_title: "Advanced Manufacturing Investment Credit",
    });
    expect(revenue.values["2022-2031"]).toBe(-24251);
    expect(reconcile(parsed.sheets)).toMatchObject({ failing: [] });
  },
);

// Infrastructure Investment and Jobs Act, CBO publication 57406, Table 2 (pages 4-7)
test.skipIf(!parsers)(
  "division and title headings carry down to provision rows that have no section number",
  async () => {
    const rows = rowsOf(await parse("iija-table2.json"));
    const programs = rows.filter((r) => r.line_kind === "program" && r.measure_kind === "outlays");
    const spr = programs.find((r) => r.section_title === "Strategic Petroleum Reserve")!;
    expect(spr).toMatchObject({ division: "I", title_no: null, sections: [], block: "direct_spending" });
    expect(spr.values["2021-2031"]).toBe(-6100);
    const transmission = programs.find((r) => r.section_title === "Transmission Facilitation Program")!;
    expect(transmission).toMatchObject({ division: "D", title_no: "I" });
    expect(transmission.values["2021-2031"]).toBe(3785);
  },
);

test.skipIf(!parsers)(
  "a title printed with its numbers on the same line is a title row; sub-rows and subtotals are not extra rows",
  async () => {
    const rows = rowsOf(await parse("iija-table2.json"));
    const titles = rows.filter(
      (r) => r.line_kind === "title" && r.block === "revenues" && r.measure_kind === "revenues",
    );
    expect(titles.map((r) => [r.division, r.title_no, r.section_title, r.values["2021-2031"]])).toContainEqual([
      "H",
      "VI",
      "Other Provisions",
      37406,
    ]);
    const titleSix = lineOf(rows, (r) => r.division === "H" && r.title_no === "VI" && r.block === "revenues");
    expect(titleSix.map((r) => r.measure_kind)).toEqual(["revenues", "on_budget_revenues", "off_budget_revenues"]);
  },
);

test.skipIf(!parsers)(
  "total columns printed as '2021-' over '2026 2031' read as ranges, and rows add up to the totals and division totals",
  async () => {
    const parsed = await parse("iija-table2.json");
    expect(parsed.sheets[0]?.years.slice(-3)).toEqual(["2031", "2021-2026", "2021-2031"]);
    const check = reconcile(parsed.sheets);
    expect(check.failing).toEqual([]);
    expect(check.checks).toBeGreaterThan(100);
    const bill = rowsOf(parsed).filter((r) => r.line_kind === "total" && r.block === "direct_spending");
    expect(total(bill, "outlays", "2021-2031")).toBe(-109619);
  },
);

test.skipIf(!parsers)("a division total that does not match its rows fails that block", async () => {
  const parsed = await parse("iija-table2.json");
  const division = rowsOf(parsed).find(
    (r) => r.line_kind === "subtotal" && r.section_title === "DIVISION I Total" && r.measure_kind === "outlays",
  )!;
  division.values["2021-2031"] = -100000;
  expect(reconcile(parsed.sheets).failing).toContain("Table 2|direct_spending|outlays");
});

// Consolidated Appropriations Act, 2023, CBO publication 58901: one table per division, section numbers repeat
test.skipIf(!parsers)(
  "tables that cover one division each tag their rows, so a repeated section number stays apart",
  async () => {
    const rows = rowsOf(await parse("caa-divisions.json"));
    const sec102 = rows.filter((r) => r.sections.includes("102") && r.measure_kind === "outlays");
    expect(sec102.map((r) => [r.division, r.values["2023-2032"]])).toEqual([
      ["U", 5],
      ["V", 15],
      ["Y", 19],
    ]);
  },
);

test.skipIf(!parsers)(
  "a title heading wrapped over two lines takes the numbers printed on its second line",
  async () => {
    const rows = rowsOf(await parse("caa-divisions.json"));
    const title = rows.find(
      (r) => r.line_kind === "title" && r.division === "T" && r.title_no === "I" && r.measure_kind === "revenues",
    )!;
    expect(title.section_title).toBe("Expanding Coverage and Increasing Retirement Savings");
    expect(title.values["2023-2032"]).toBe(-27020);
    const division = rowsOf(await parse("caa-divisions.json")).filter(
      (r) => r.division === "O" && r.line_kind === "title",
    );
    expect(division.map((r) => r.section_title)).toContain("Extension of FCC Auction Authority");
  },
);

test.skipIf(!parsers)("every division table in the omnibus adds up to its printed total", async () => {
  const parsed = await parse("caa-divisions.json");
  expect(reconcile(parsed.sheets).failing).toEqual([]);
});

// Bipartisan Safer Communities Act, Table 2: 'Title II - Firearms' carries revenue with no section numbers
test.skipIf(!parsers)("a division named in the table's caption applies to its title rows", async () => {
  const rows = rowsOf(await parse("s2938-table2.json"));
  const firearms = rows.find((r) => r.line_kind === "title" && r.block === "revenues")!;
  expect(firearms).toMatchObject({ division: "A", title_no: "II", section_title: "Firearms" });
  expect(firearms.values["2022-2032"]).toBe(12);
});

// National Defense Authorization Act for FY2026, CBO publication 61935: no 'Table N' heading, labels wrapped over lines
test.skipIf(!parsers)(
  "a table without a Table N heading is read from its column labels, wrapped measure labels included",
  async () => {
    const parsed = await parse("ndaa-direct-spending.json");
    const sections = rowsOf(parsed).filter((r) => r.line_kind === "section" && r.measure_kind === "budget_authority");
    expect(sections.map((r) => [r.sections[0], r.section_title, r.values["2026-2035"]])).toEqual([
      ["603", "Early Retirement Authority", -25],
      ["652", "Commissaries and Exchanges", -2],
      ["1411", "Strategic Stockpile", -20],
      ["6502", "Tort Claims Related to Unmanned Aircraft Systems", 1],
      ["7222", "Deferred Retirement for Health Professions Officers", -4],
      ["8204", "Death Benefits for Public Safety Officers", 1],
      ["8205", "Benefits for Public Safety Officers and Rescission", 10],
    ]);
    expect(sections.every((r) => r.block === "direct_spending")).toBe(true);
    expect(reconcile(parsed.sheets)).toMatchObject({ failing: [], checks: 24 });
  },
);
