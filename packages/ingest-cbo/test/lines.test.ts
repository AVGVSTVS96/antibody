import { expect, test } from "bun:test";
import { TABLES } from "@antibody/core";
import { buildLines, locator, reconcile } from "../src/lines.ts";
import type { Glance, Parsed, ParsedRow } from "../src/parsed.ts";

const years = ["2025", "2025-2034"];
const v = (a: number, b: number) => ({ "2025": a, "2025-2034": b });
const row = (r: Partial<ParsedRow> & Pick<ParsedRow, "measure_kind" | "values" | "range">): ParsedRow => ({
  sheet: "Title I",
  block: "direct_spending",
  line_kind: "section",
  sections: [],
  section_title: null,
  component: null,
  measure: r.measure_kind,
  ...r,
});

const parsed: Parsed = {
  format: "xlsx",
  summary: {
    sheet: "Summary Table",
    years,
    rows: [
      {
        measure: "Net Effect on the Deficit",
        measure_kind: "deficit",
        values: v(1, -60),
        range: "'Summary Table'!A75:O75",
      },
    ],
  },
  sheets: [
    {
      sheet: "Title I",
      years,
      rows: [
        row({
          line: 1,
          sections: ["101"],
          section_title: "Food plan",
          measure_kind: "outlays",
          values: v(0, -40),
          range: "'Title I'!A10:O11",
        }),
        row({
          line: 2,
          sections: ["102", "103"],
          section_title: "Group",
          measure_kind: "outlays",
          values: v(0, -21),
          range: "'Title I'!A12:O13",
        }),
        row({
          line: 3,
          sections: ["101"],
          section_title: "Food plan",
          block: "revenues",
          measure_kind: "revenues",
          values: v(0, 5),
          range: "'Title I'!A30:O31",
        }),
        row({ line: 4, line_kind: "total", measure_kind: "outlays", values: v(0, -61), range: "'Title I'!A20:O20" }),
        row({
          line: 5,
          line_kind: "total",
          block: "revenues",
          measure_kind: "revenues",
          values: v(0, 5),
          range: "'Title I'!A40:O40",
        }),
      ],
    },
  ],
};

const src = {
  estimateId: "119-hr-9.cbo-1",
  billId: "119-hr-9",
  fileUrl: "https://www.cbo.gov/system/files/2025-07/hr9.xlsx",
  archiveUrl: "https://web.archive.org/web/20250701000000/https://www.cbo.gov/system/files/2025-07/hr9.xlsx",
  pdfUrl: null,
  pdfArchiveUrl: null,
};
const ids = (n: string) => `119-hr-9@ih:sec:${n}`;

test("section rows add up to CBO's printed totals", () => {
  expect(reconcile(parsed.sheets)).toEqual({ checks: 4, exact: 4, failing: [] });
});

test("every line is a valid cbo_lines row", () => {
  const { lines } = buildLines(src, parsed, null, ids);
  for (const l of lines) expect(TABLES.cbo_lines.schema.safeParse(l).error).toBeUndefined();
});

test("a grouped CBO line stays a fact; its even split per section is marked and rests on it, sign kept", () => {
  const { lines } = buildLines(src, parsed, null, ids);
  const group = lines.find((l) => l.line_kind === "group" && l.measure === "outlays")!;
  expect(group).toMatchObject({ section_nums: ["102", "103"], total_musd: -21, split: "exact" });
  const s102 = lines.find((l) => l.id === "119-hr-9.cbo-1:s102:outlays")!;
  expect(s102).toMatchObject({ split: "even_split", total_musd: -10.5, rests_on: [`cbo_lines/${group.id}`] });
  expect(s102.section_ids).toEqual(["119-hr-9@ih:sec:102"]);
});

test("a section's deficit rests on its outlay and revenue lines and cites every range it adds", () => {
  const { lines } = buildLines(src, parsed, null, ids);
  const d = lines.find((l) => l.id === "119-hr-9.cbo-1:s101:deficit")!;
  expect(d.total_musd).toBe(-45);
  expect(d.rests_on).toEqual(["cbo_lines/119-hr-9.cbo-1:s101:outlays", "cbo_lines/119-hr-9.cbo-1:s101:revenues"]);
  expect(d.source_locator).toBe("Title I sheet, cells A10:O11; Title I sheet, cells A30:O31");
  expect(d.spending).toBeNull();
});

test("a title that doesn't reconcile ships CBO's total as a group, not per-section numbers", () => {
  const broken = structuredClone(parsed);
  broken.sheets[0]!.rows[3]!.values = v(0, -99);
  const { lines, reconcile: r } = buildLines(src, broken, null, ids);
  expect(r.failing).toEqual(["Title I|direct_spending|outlays"]);
  expect(lines.some((l) => l.id.endsWith(":s101:outlays"))).toBe(false);
  expect(lines.find((l) => l.id === "119-hr-9.cbo-1:t0:outlays")).toMatchObject({
    total_musd: -99,
    line_kind: "group",
  });
});

test("whole-bill figures come from the summary; the At a Glance box adds discretionary spending", () => {
  const glance: Glance = {
    pages: [],
    glance: {
      periods: ["2025", "2025-2030", "2025-2035"],
      rows: [
        {
          label: "Increase or Decrease (-) in the Deficit",
          values: { "2025": 0, "2025-2030": 53, "2025-2035": 120 },
          raw: {},
        },
        {
          label: "Spending Subject to Appropriation (Outlays)",
          values: { "2025": 0, "2025-2030": 4, "2025-2035": null },
          raw: {},
        },
      ],
    },
    mandates: { intergovernmental: "No", private_sector: "No" },
    baseline_month: null,
    budget_enforcement_baseline: false,
  };
  const pdf = { ...src, pdfUrl: "https://www.cbo.gov/system/files/2025-07/hr9.pdf", pdfArchiveUrl: null };
  const whole = buildLines(pdf, parsed, glance, ids).lines.filter((l) => l.line_kind === "whole-bill");
  expect(whole.map((l) => [l.measure, l.spending, l.period, l.total_musd, l.source_url])).toEqual([
    ["deficit", null, "2025-2034", -60, src.fileUrl],
    ["outlays", "discretionary", "2025-2030", 4, pdf.pdfUrl],
  ]);
});

test("locators read like a person would say them", () => {
  expect(locator(["'Title VII'!A19:O21", "'Title VII'!A374:O375", "page 3"])).toBe(
    "Title VII sheet, cells A19:O21 and A374:O375; page 3",
  );
});
