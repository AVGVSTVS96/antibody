import { expect, test } from "bun:test";
import type { Row } from "@antibody/core";
import { attention } from "../src/attention.ts";
import { menu, withParts } from "../src/match.ts";
import type { MatchRun } from "../src/match.ts";
import { asSection, partLocator, partSections } from "../src/parts.ts";
import { scoreRows, sectionDollars } from "../src/score.ts";
import { articleRow, attentionRow, must, reachRow, sectionRow } from "./rows.ts";

const section = (id: string, over: Partial<Row<"sections">> = {}) => {
  const num = id.replace(/^s/u, "");

  return sectionRow(id, { num, path: `title:I/sec:${num}`, ...over });
};

const part = (id: string, section_id: string, over: Partial<Row<"section_parts">> = {}) => ({
  id,
  bill_id: "119-hr-1",
  section_id,
  num: `${section_id.replace(/^s/u, "")}(c)`,
  ord: 2,
  enum: "(c)",
  heading: "Moratorium",
  trail: [],
  path: "subsection:c",
  lead_in: false,
  words: 120,
  preview: "no State or political subdivision thereof may enforce any law or regulation",
  first_version: "rh",
  late: false,
  version: "plaw",
  source_url: "https://www.govinfo.gov/content/pkg/PLAW-119publ21/uslm/PLAW-119publ21.xml",
  source_locator: "sec. 1, subsection (c)",
  ...over,
});

const article = (id: string, outlet: string) => articleRow(id, { outlet_id: outlet, text_chars: 2000 });

const loud = (id: string) =>
  attentionRow(`b:${id}`, { section_id: id, hits: 40, pct: 1, evidence: { balanced_share: 0.4 } });

const tag = (id: string, partId: string | null) =>
  reachRow(`${id}#states`, {
    section_id: "s0",
    part_id: partId,
    kind: "states",
    pattern: "no-state-may",
    quote: "no State or political subdivision thereof may enforce any law or regulation regulating AI",
  });

test("an article tied to a part counts for its section too, and the part is ranked against the sections", () => {
  const arts = [
    ...Array.from({ length: 12 }, (_, i) => article(`L${i}`, "rawstory.com")),
    ...Array.from({ length: 12 }, (_, i) => article(`R${i}`, "foxnews.com")),
  ];

  const matches: MatchRun["matches"] = {};

  for (const a of arts) {
    matches[a.id] = {
      about: "bill",
      sections: a.id === "L0" || a.id === "R0" ? ["s1(c)"] : ["s1"],
      whole: false,
      outside: null,
    };
  }

  const run: MatchRun = { matcher: "t", model: "t", menuHash: "t", costUsd: 0, matches };
  const res = attention("119-hr-1", [section("s1"), section("s2")], arts, run, [part("s1(c)", "s1")]);
  const own = must(res.rows.find((r) => r.section_id === "s1" && r.part_id === null));
  const p = must(res.rows.find((r) => r.part_id === "s1(c)"));
  expect([own.hits, p.hits, p.section_id]).toEqual([24, 2, "s1"]);
  expect(p.rests_on).toEqual(["articles/L0", "articles/R0"]);
  expect(res.rows.find((r) => r.section_id === "s2")?.hits).toBe(0);
});

test("a loud section's quiet part with reach is buried on its own, with no dollars of the section's", () => {
  const sections = Array.from({ length: 12 }, (_, i) => section(`s${i}`));

  const quietPart = attentionRow("b:s0(c)", {
    section_id: "s0",
    part_id: "s0(c)",
    pct: 0,
    evidence: { balanced_share: 0 },
  });

  const rows = scoreRows(
    "119-hr-1",
    sections,
    [
      loud("s0"),
      ...sections.slice(1).map((s) => ({ ...loud(s.id), hits: 0, pct: 0, evidence: { balanced_share: 0 } })),
      quietPart,
    ],
    sectionDollars([], []),
    new Map(),
    new Map(),
    [],
    [],
    [tag("s0", null), tag("s0(c)", "s0(c)")],
    [part("s0(c)", "s0", { late: true })],
  );

  const whole = must(rows.find((r) => r.section_id === "s0" && r.part_id === null));
  const p = must(rows.find((r) => r.part_id === "s0(c)"));
  expect(whole.label).toBe("headline");
  expect([p.label, p.section_id, p.dollars_musd, p.lobbying_firms, p.reach, p.late]).toEqual([
    "buried",
    "s0",
    null,
    0,
    ["states"],
    true,
  ]);
  expect(p.rests_on).toEqual(["section_parts/s0(c)", "sections/s0", "attention/b:s0(c)", "section_reach/s0(c)#states"]);
  expect(rows.filter((r) => r.part_id === null)).toHaveLength(12);
});

test("a part of a dropped section is read but never scored", () => {
  const rows = scoreRows(
    "119-hr-1",
    [section("s0", { in_final: false }), section("s1")],
    [],
    sectionDollars([], []),
    new Map(),
    new Map(),
    [],
    [],
    [],
    [part("s0(c)", "s0")],
  );

  expect(rows.map((r) => r.section_id)).toEqual(["s1"]);
});

test("a part offered to the matcher names its section, sits right after it, and keeps a dropped mark", () => {
  const s = section("s43201", { num: "43201", heading: "AI and IT modernization initiative", in_final: false });
  const p = part("s43201(c)", "s43201", { num: "43201(c)" });
  const items = withParts([s, section("s43202")], [{ ...asSection(p, s), parent: s.id }]);
  expect(items.map((x) => x.id)).toEqual(["s43201", "s43201(c)", "s43202"]);
  expect(menu(items).text.split("\n")[1]).toBe(
    "S2 | sec. 43201(c) | Moratorium (part of sec. 43201, AI and IT modernization initiative) [dropped before the final text] | no State or political subdivision thereof may enforce any law or regulation",
  );
  expect(partSections([s], [p, part("other", "s9")]).map((x) => x.id)).toEqual(["s43201(c)"]);
});

test("a part's locator walks from the section's containers down to its own enums", () => {
  expect(partLocator("title:IV/subtitle:C/sec:43201", "subsection:c")).toBe(
    "title IV, subtitle C, sec. 43201, subsection (c)",
  );
  expect(partLocator("sec:4", "subsection:a/paragraph:12")).toBe("sec. 4, subsection (a), paragraph (12)");
  expect(partLocator("sec:4", "")).toBe("sec. 4, opening words");
});
