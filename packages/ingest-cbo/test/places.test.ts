import { expect, test } from "bun:test";
import { type Row, TABLES } from "@antibody/core";
import { buildLines, EVEN_SPLIT_MAX } from "../src/lines.ts";
import type { Parsed, ParsedRow } from "../src/parsed.ts";
import { type Labelled, sectionIndex, sectionMap } from "../src/sections.ts";

const section = (id: string, path: string, heading: string) =>
  ({ id, history: { enr: { path, heading } } }) as unknown as Row<"sections">;

const divisionI = [
  section("i1", "division:I/sec:90001", "EXTENSION OF DIRECT SPENDING REDUCTIONS THROUGH FISCAL YEAR 2031."),
  section("i2", "division:I/sec:90002", "STRATEGIC PETROLEUM RESERVE DRAWDOWN AND SALE."),
  section(
    "i4",
    "division:I/sec:90004",
    "REQUIRING MANUFACTURERS OF CERTAIN SINGLE-DOSE CONTAINER OR SINGLE-USE PACKAGE DRUGS PAYABLE UNDER PART B OF THE MEDICARE PROGRAM TO PROVIDE REFUNDS WITH RESPECT TO DISCARDED AMOUNTS OF SUCH DRUGS.",
  ),
  section("i5", "division:I/sec:90005", "EXTENSION OF ENTERPRISE GUARANTEE FEES."),
  section(
    "i6",
    "division:I/sec:90006",
    "MORATORIUM ON IMPLEMENTATION OF RULE RELATING TO ELIMINATING THE ANTI-KICKBACK STATUTE SAFE HARBOR PROTECTION FOR PRESCRIPTION DRUG REBATES.",
  ),
  section("i8", "division:I/sec:90008", "SPECTRUM AUCTIONS."),
  section(
    "d40105",
    "division:D/title:I/subtitle:A/sec:40105",
    "SITING OF INTERSTATE ELECTRIC TRANSMISSION FACILITIES.",
  ),
  section("d40106", "division:D/title:I/subtitle:A/sec:40106", "TRANSMISSION FACILITATION PROGRAM."),
];
const places = sectionIndex(divisionI, null).places;

test("a provision label joins the one heading under its division that holds its words, plurals and rewording aside", () => {
  expect(places.heading("Spectrum Auctions", { division: "I", title: null })?.id).toBe("i8");
  expect(places.heading("Strategic Petroleum Reserve", { division: "I", title: null })?.id).toBe("i2");
  expect(
    places.heading("Delaying Rule Affecting Treatment of Certain Rebates for Prescription Drugs", {
      division: "I",
      title: null,
    }),
  ).toMatchObject({
    id: "i6",
    num: "90006",
    division: "I",
    version: "enr",
  });
  expect(
    places.heading("Manufacturer Rebates for Unused Drugs in Medicare Part B", { division: "I", title: null })?.id,
  ).toBe("i4");
});

test("a label that holds all its words in one heading beats a heading that shares only some of them", () => {
  const found = places.heading("Transmission Facilitation Program", { division: "D", title: "I" });
  expect(found?.id).toBe("d40106");
});

test("a label never joins outside its division or title, nor on a single shared word, nor between equal candidates", () => {
  expect(places.heading("Spectrum Auctions", { division: "D", title: null })).toBeUndefined();
  expect(places.heading("Spectrum Auctions", { division: "I", title: "II" })).toBeUndefined();
  expect(places.heading("Medicare", { division: "I", title: null })).toBeUndefined();
  expect(places.heading("Extension", { division: "I", title: null })).toBeUndefined();
  const twins = sectionIndex(
    [section("a", "division:I/sec:1", "Rural water grants"), section("b", "division:I/sec:2", "Rural water grants")],
    null,
  ).places;
  expect(twins.heading("Rural Water Grants", { division: "I", title: null })).toBeUndefined();
});

test("everything under a division and title, in section order; a table with no division means a bill with none", () => {
  const bill = [
    section("a2", "division:A/title:II/sec:12002", "Two"),
    section("a1", "division:A/title:II/sec:12001", "One"),
    section("a3", "division:A/title:III/sec:12010", "Three"),
    section("plain", "title:II/sec:5", "Plain"),
  ];
  const { places: p } = sectionIndex(bill, null);
  expect(p.under({ division: "A", title: "II" }).map((s) => s.num)).toEqual(["12001", "12002"]);
  expect(p.under({ division: null, title: "II" }).map((s) => s.id)).toEqual(["plain"]);
  expect(p.under({ division: "B", title: null })).toEqual([]);
});

test("a number joins within the division CBO's table names, so a repeated number finds its own section", () => {
  const omnibus = [
    section("u102", "division:U/title:I/sec:102", "Treatment and research of prostate cancer"),
    section("v102", "division:V/title:I/sec:102", "Expansion of Vet Center workforce"),
    section("y102", "division:Y/sec:102", "Annuity supplement"),
  ];
  const join = sectionMap(omnibus, "enr");
  expect(join("102", "Expansion of Vet Center Workforce", false, "V")).toBe("v102");
  expect(join("102", "Annuity Supplement", false, "Y")).toBe("y102");
  expect(join("102", "Annuity Supplement", false, "V")).toBeUndefined();
  expect(join("102", "Annuity Supplement")).toBe("y102");
});

test("in a numbering the estimate's other rows confirm, a label that shares a word only its section's heading has still joins", () => {
  const bill = [
    section(
      "m",
      "title:II/sec:20004",
      "Enhancement of Department of Defense resources for munitions and defense supply chain resiliency",
    ),
    section(
      "a",
      "title:II/sec:20005",
      "Enhancement of Department of Defense resources for scaling low-cost weapons into production",
    ),
    section("c", "title:IV/sec:44121", "Expansion of Medicaid community engagement"),
    section("d", "title:IV/sec:44122", "Reducing State Medicaid costs"),
    section("e", "title:IV/sec:44123", "Medicaid provider taxes"),
  ];
  const confirmed = [
    { num: "20005", title: "Scaling Low-Cost Weapons Into Production" },
    { num: "44123", title: "Medicaid Provider Taxes" },
  ];
  const join = sectionMap(bill, "enr", confirmed);
  expect(join("20004", "Munitions and Industrial Base")).toBe("m");
  expect(join("44122", "Expansion FMAP for Emergency Medicaid")).toBeUndefined();
  expect(
    sectionMap(bill, "enr", [{ num: "20005", title: "Unrelated" }])("20004", "Munitions and Industrial Base"),
  ).toBeUndefined();
});

const years = ["2021", "2021-2031"];
const row = (
  r: Partial<ParsedRow> & Pick<ParsedRow, "line" | "line_kind" | "measure_kind" | "section_title">,
  total: number,
): ParsedRow => ({
  sheet: "Table 2",
  block: "direct_spending",
  sections: [],
  component: null,
  measure: r.measure_kind,
  values: { "2021": 0, "2021-2031": total },
  range: "page 6",
  ...r,
});
const src = {
  estimateId: "117-hr-3684.cbo-57406",
  billId: "117-hr-3684",
  fileUrl: "https://www.cbo.gov/system/files/2021-08/hr3684_infrastructure.pdf",
  archiveUrl: null,
  pdfUrl: null,
  pdfArchiveUrl: null,
};
const table = (...rows: ParsedRow[]): Parsed => ({
  format: "pdf",
  summary: null,
  sheets: [{ sheet: "Table 2", years, rows }],
});
const build = (parsed: Parsed, sections: Row<"sections">[], evidence: Labelled[] = []) => {
  const index = sectionIndex(sections, null, evidence);
  const built = buildLines(src, parsed, null, index.join, index.places);
  for (const l of built.lines) expect(TABLES.cbo_lines.schema.safeParse(l).error).toBeUndefined();
  return built.lines;
};

test("a provision row joined by heading is exact in dollars, marked as a heading join, and says what it rests on", () => {
  const lines = build(
    table(
      row(
        { line: 1, line_kind: "program", measure_kind: "outlays", section_title: "Spectrum Auctions", division: "I" },
        -10175,
      ),
    ),
    divisionI,
  );
  const line = lines.find((l) => l.id === `${src.estimateId}:sI.90008:outlays`)!;
  expect(line).toMatchObject({
    line_kind: "section",
    join: "heading",
    split: "exact",
    total_musd: -10175,
    section_ids: ["i8"],
    section_nums: ["90008"],
  });
  expect(line.source_locator).toContain("CBO printed no section number");
  expect(line.source_locator).toContain('section 90008 ("SPECTRUM AUCTIONS.") of division I in the enr text');
});

test("a provision row no heading names stays a group line with no sections, and says why", () => {
  const lines = build(
    table(
      row(
        {
          line: 1,
          line_kind: "program",
          measure_kind: "outlays",
          section_title: "Contract Authority for Programs Funded by the Highway Trust Fund",
          division: "I",
        },
        149931,
      ),
    ),
    divisionI,
  );
  expect(lines.filter((l) => l.line_kind === "section")).toEqual([]);
  expect(lines.find((l) => l.line_kind === "group")).toMatchObject({ section_ids: [], join: null, total_musd: 149931 });
  expect(lines[0]?.source_locator).toContain("no section heading under division I matches this row");
});

test("two rows that would take the same section take neither", () => {
  const lines = build(
    table(
      row(
        { line: 1, line_kind: "program", measure_kind: "outlays", section_title: "Spectrum Auctions", division: "I" },
        -10,
      ),
      row(
        {
          line: 2,
          line_kind: "program",
          measure_kind: "outlays",
          section_title: "Spectrum Auctions Authority",
          division: "I",
        },
        -20,
      ),
    ),
    divisionI,
  );
  expect(lines.filter((l) => l.line_kind === "section")).toEqual([]);
});

const titleSections = (n: number) =>
  Array.from({ length: n }, (_, i) => section(`s${i}`, `division:D/title:VII/sec:${40700 + i}`, `Provision ${i}`));

test("a title with one section is that section's figure; a few sections share it evenly, labelled and resting on the title's line", () => {
  const title = (d: number) =>
    row(
      {
        line: 1,
        line_kind: "title",
        measure_kind: "outlays",
        section_title: "Abandoned Mine Land Reclamation",
        division: "D",
        title_no: "VII",
      },
      d,
    );
  const one = build(table(title(1243)), titleSections(1));
  expect(one.find((l) => l.line_kind === "section")).toMatchObject({ join: "title", split: "exact", total_musd: 1243 });

  const four = build(table(title(1000)), titleSections(4));
  const group = four.find((l) => l.line_kind === "group")!;
  const shares = four.filter((l) => l.line_kind === "section" && l.measure === "outlays");
  expect(group).toMatchObject({ join: "title", total_musd: 1000, section_nums: ["40700", "40701", "40702", "40703"] });
  expect(shares.map((l) => [l.split, l.total_musd, l.rests_on])).toEqual(
    Array(4).fill(["even_split", 250, [`cbo_lines/${group.id}`]]),
  );
  expect(shares[0]?.source_locator).toContain("all of division D title VII, which has 4 sections");
});

test(`a title of more than ${EVEN_SPLIT_MAX} sections stays one group line: an even share of it would be noise`, () => {
  const lines = build(
    table(
      row(
        {
          line: 1,
          line_kind: "title",
          measure_kind: "outlays",
          section_title: "Federal-Aid Highways",
          division: "D",
          title_no: "VII",
        },
        149931,
      ),
    ),
    titleSections(EVEN_SPLIT_MAX + 1),
  );
  expect(lines.filter((l) => l.line_kind === "section")).toEqual([]);
  const group = lines.find((l) => l.line_kind === "group")!;
  expect(group).toMatchObject({ section_ids: [], section_nums: [], total_musd: 149931, join: "title" });
  expect(group.source_locator).toContain(`more than ${EVEN_SPLIT_MAX} sections`);
});

test("a footnote on a provision row that names one section ties the row to it, when the heading fits", () => {
  const notes = {
    g: "CBO estimates that implementing section 40106 would increase net direct spending by $3.8 billion. The rest.",
    h: "Section 40110 would increase the amount. Section 40111 is also named.",
    i: "This proposal also would affect revenues.",
  };
  const parsed = table(
    row(
      {
        line: 1,
        line_kind: "program",
        measure_kind: "outlays",
        section_title: "Transmission Facilitation Program",
        division: "D",
        title_no: "I",
        marks: ["g"],
      },
      3785,
    ),
    row(
      {
        line: 2,
        line_kind: "program",
        measure_kind: "outlays",
        section_title: "Something Else Entirely",
        division: "D",
        title_no: "I",
        marks: ["g"],
      },
      9,
    ),
    row(
      {
        line: 3,
        line_kind: "program",
        measure_kind: "outlays",
        section_title: "Power Marketing Borrowing",
        division: "D",
        marks: ["h", "i"],
      },
      5,
    ),
  );
  parsed.sheets[0]!.notes = notes;
  const lines = build(parsed, divisionI);
  const named = lines.find((l) => l.id.endsWith(":sD.40106:outlays"))!;
  expect(named).toMatchObject({ join: "number", split: "exact", total_musd: 3785, section_ids: ["d40106"] });
  expect(named.source_locator).toContain(
    'CBO\'s note g on this row names section 40106: "CBO estimates that implementing section 40106 would increase net direct spending by $3.8 billion."',
  );
  expect(lines.filter((l) => l.line_kind === "section" && l.total_musd === 9)).toEqual([]);
});

test("a repeated section number in two divisions makes two lines, not one summed line", () => {
  const omnibus = [
    section("u102", "division:U/sec:102", "Prostate cancer research"),
    section("v102", "division:V/sec:102", "Vet Center workforce"),
  ];
  const lines = build(
    table(
      row(
        {
          line: 1,
          line_kind: "section",
          measure_kind: "outlays",
          section_title: "Prostate Cancer Research",
          sections: ["102"],
          division: "U",
        },
        5,
      ),
      row(
        {
          line: 2,
          line_kind: "section",
          measure_kind: "outlays",
          section_title: "Vet Center Workforce",
          sections: ["102"],
          division: "V",
        },
        15,
      ),
    ),
    omnibus,
  );
  expect(
    lines
      .filter((l) => l.line_kind === "section" && l.measure === "outlays")
      .map((l) => [l.id.split(":")[1], l.section_ids, l.total_musd]),
  ).toEqual([
    ["sU.102", ["u102"], 5],
    ["sV.102", ["v102"], 15],
  ]);
});

test("a group CBO printed is split only up to the same size limit, and its members carry the sections the group resolved", () => {
  const sections = Array.from({ length: 10 }, (_, i) =>
    section(`g${i}`, `title:I/sec:${100 + i}`, `Group member ${i}`),
  );
  const nums = sections.map((_, i) => String(100 + i));
  const printed = (members: string[]) =>
    table(
      row(
        { line: 1, line_kind: "section", measure_kind: "outlays", section_title: "Group member 0", sections: ["100"] },
        5,
      ),
      row(
        {
          line: 2,
          line_kind: "section",
          measure_kind: "outlays",
          section_title: "Some other wording",
          sections: members,
        },
        600,
      ),
    );
  const verified = [{ num: "100", title: "Group member 0" }];
  const small = build(printed(nums.slice(1, 4)), sections, verified);
  expect(
    small
      .filter((l) => l.split === "even_split" && l.measure === "outlays")
      .map((l) => [l.section_ids.length, l.total_musd]),
  ).toEqual([
    [1, 200],
    [1, 200],
    [1, 200],
  ]);
  const large = build(printed(nums.slice(1)), sections, verified);
  expect(large.filter((l) => l.split === "even_split")).toEqual([]);
  expect(large.find((l) => l.line_kind === "group")).toMatchObject({ join: "number", total_musd: 600 });
});
