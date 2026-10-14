import { expect, test } from "bun:test";
import type { Row } from "@antibody/core";
import { attention, percentile } from "../src/attention.ts";
import type { MatchRun } from "../src/match.ts";
import { BOILERPLATE, buried, label, SCORE, sectionDollars, stakes } from "../src/score.ts";

test("stakes put dollars and lobbying on log scales, and cuts count the same as costs", () => {
  expect(stakes({ dollarsMusd: 1000, lobbyingReports: 0 })).toBeCloseTo(0.5, 2);
  expect(stakes({ dollarsMusd: -1000, lobbyingReports: 0 })).toBeCloseTo(0.5, 2);
  expect(stakes({ dollarsMusd: 1_000_000, lobbyingReports: 0 })).toBeCloseTo(1, 2);
  expect(stakes({ dollarsMusd: null, lobbyingReports: 100 })).toBeCloseTo(1, 2);
  expect(stakes({ dollarsMusd: null, lobbyingReports: 10 })).toBeCloseTo(0.52, 2);
});

test("buried = stakes × quiet × sneak, and needs attention to exist", () => {
  const base = { dollarsMusd: 10_000, attentionPct: 0.2, late: false, offTopic: 0, lobbyingReports: 0 };
  const s = stakes(base);
  expect(buried(base)).toBeCloseTo(s * 0.8, 3);
  expect(buried({ ...base, late: true })).toBeCloseTo(s * 0.8 * 1.25, 3);
  expect(buried({ ...base, late: true, offTopic: 1 })).toBeCloseTo(s * 0.8 * 1.5, 3);
  expect(buried({ ...base, attentionPct: null })).toBeNull();
});

test("labels use one set of thresholds", () => {
  const quiet = { dollarsMusd: 100_000, attentionPct: 0.05, late: false, offTopic: null, lobbyingReports: 0 };
  expect(label(quiet, 0)).toBe("buried");
  expect(label({ ...quiet, dollarsMusd: 500 }, 0)).toBe("normal");
  expect(label({ ...quiet, attentionPct: 0.95 }, SCORE.headlineMinHits)).toBe("headline");
  expect(label({ ...quiet, attentionPct: 0.95 }, SCORE.headlineMinHits - 1)).not.toBe("headline");
});

test("the score never sees party: the same components give the same score for any bill", () => {
  const c = { dollarsMusd: 4000, attentionPct: 0.1, late: true, offTopic: 0.7, lobbyingReports: 3 };
  expect(buried.length).toBe(1);
  expect(buried({ ...c })).toBe(buried({ ...c }));
});

test("percentile counts ties as half", () => {
  expect(percentile(0, [0, 0, 0, 1])).toBeCloseTo(1 / 3, 5);
  expect(percentile(1, [0, 0, 0, 1])).toBe(1);
  expect(percentile(0, [0, 1, 2])).toBe(0);
});

test("boilerplate headings get no off-topic value", () => {
  for (const h of ["Short title", "Definitions", "Effective date", "Technical and conforming amendments"])
    expect(BOILERPLATE.test(h)).toBe(true);
  expect(BOILERPLATE.test("Drought mitigation in the Reclamation States")).toBe(false);
});

const line = (over: Partial<Row<"cbo_lines">>): Row<"cbo_lines"> =>
  ({
    id: "l",
    estimate_id: "e",
    bill_id: "119-hr-1",
    line_kind: "section",
    section_nums: [],
    section_ids: ["s1"],
    title: null,
    measure: "outlays",
    period: "2025-2034",
    total_musd: 0,
    values: {},
    split: "exact",
    archive_url: null,
    rests_on: [],
    source_url: "https://www.cbo.gov/publication/61570",
    source_locator: null,
    ...over,
  }) as Row<"cbo_lines">;

test("section dollars are a signed deficit effect and remember even splits", () => {
  const est = {
    id: "e",
    per_section: true,
    baseline: "current-law",
    published_on: "2025-07-21",
  } as Row<"cbo_estimates">;
  const d = sectionDollars(
    [est],
    [
      line({ id: "o", measure: "outlays", total_musd: -149_424, split: "even_split" }),
      line({ id: "r", measure: "revenues", total_musd: 100 }),
      line({ id: "x", section_ids: ["s2"], measure: "deficit", total_musd: 2_193_378 }),
    ],
  );
  expect(d.bySection.get("s1")).toMatchObject({ musd: -149_524, split: "even_split", measure: "outlays - revenues" });
  expect(d.bySection.get("s2")).toMatchObject({ musd: 2_193_378, split: "exact", measure: "deficit" });
});

const section = (id: string, in_final = true) => ({ id, in_final }) as Row<"sections">;
const article = (id: string, outlet: string) =>
  ({ id, outlet_id: outlet, text_chars: 100, via: "mediacloud" }) as Row<"articles">;

test("each side weighs the same, however many articles it publishes", () => {
  const arts = [
    ...Array.from({ length: 30 }, (_, i) => article(`L${i}`, "rawstory.com")),
    ...Array.from({ length: 10 }, (_, i) => article(`C${i}`, "thehill.com")),
    ...Array.from({ length: 10 }, (_, i) => article(`R${i}`, "foxnews.com")),
  ];
  const matches: MatchRun["matches"] = {};
  for (const a of arts) {
    const onA = a.id.startsWith("L");
    const onB = a.id.startsWith("R");
    matches[a.id] = { about: "bill", sections: onA ? ["a"] : onB ? ["b"] : [], whole: false, outside: null };
  }
  const run: MatchRun = { matcher: "t", model: "t", menuHash: "t", costUsd: 0, matches };
  const res = attention("119-hr-1", [section("a"), section("b"), section("c")], arts, run);
  expect(res.share.get("a")).toBeCloseTo(res.share.get("b")!, 6);
  const row = (id: string) => res.rows.find((r) => r.section_id === id)!;
  expect(row("a").pct).toBe(row("b").pct);
  expect(row("a").hits).toBe(30);
  expect(row("b").hits).toBe(10);
});
