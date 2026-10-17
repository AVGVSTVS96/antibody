import { expect, test } from "bun:test";
import type { Row } from "@antibody/core";
import { BIG_STAKES, MIN_SECTIONS_TO_BURY } from "@antibody/core";
import { attention, percentile } from "../src/attention.ts";
import type { MatchRun } from "../src/match.ts";
import { BOILERPLATE, buried, label, quiet, SCORE, scoreRows, sectionDollars, stakes } from "../src/score.ts";

test("stakes put dollars and lobbying on log scales, and cuts count the same as costs", () => {
  expect(stakes({ dollarsMusd: 1000, lobbyingReports: 0 })).toBeCloseTo(0.5, 2);
  expect(stakes({ dollarsMusd: -1000, lobbyingReports: 0 })).toBeCloseTo(0.5, 2);
  expect(stakes({ dollarsMusd: 1_000_000, lobbyingReports: 0 })).toBeCloseTo(1, 2);
  expect(stakes({ dollarsMusd: null, lobbyingReports: 100 })).toBeCloseTo(1, 2);
  expect(stakes({ dollarsMusd: null, lobbyingReports: 10 })).toBeCloseTo(0.52, 2);
});

test("quiet runs from 1 (nobody discussed it) down to 0 at one article in a hundred", () => {
  expect(quiet({ attentionPct: 0, attentionShare: 0 })).toBe(1);
  expect(quiet({ attentionPct: 0.7, attentionShare: 0.005 })).toBeCloseTo(0.5, 6);
  expect(quiet({ attentionPct: 0.9, attentionShare: SCORE.quietShare })).toBe(0);
  expect(quiet({ attentionPct: 0.99, attentionShare: 0.2 })).toBe(0);
  expect(quiet({ attentionPct: null, attentionShare: null })).toBeNull();
});

test("buried = stakes × quiet × sneak, and needs attention to exist", () => {
  const base = {
    dollarsMusd: 10_000,
    attentionPct: 0.7,
    attentionShare: 0.002,
    late: false,
    offTopic: 0,
    lobbyingReports: 0,
  };
  const s = stakes(base);
  expect(buried(base)).toBeCloseTo(s * 0.8, 3);
  expect(buried({ ...base, late: true })).toBeCloseTo(s * 0.8 * 1.25, 3);
  expect(buried({ ...base, late: true, offTopic: 1 })).toBeCloseTo(s * 0.8 * 1.5, 3);
  expect(buried({ ...base, attentionPct: null, attentionShare: null })).toBeNull();
});

const costlyQuiet = {
  dollarsMusd: 100_000,
  attentionPct: 0,
  attentionShare: 0,
  late: false,
  offTopic: null,
  lobbyingReports: 0,
  sections: 150,
};

test("costly and quiet is buried; late or off-topic is not needed", () => {
  expect(label(costlyQuiet, 0)).toBe("buried");
  expect(label({ ...costlyQuiet, titles: 9, offTopic: 0.1 }, 0)).toBe("buried");
  expect(label({ ...costlyQuiet, late: true }, 0)).toBe("buried");
});

test("a section that is not costly, or not quiet, is normal", () => {
  expect(label({ ...costlyQuiet, dollarsMusd: 9_000 }, 0)).toBe("normal");
  expect(label({ ...costlyQuiet, attentionPct: 0.8, attentionShare: 0.02 }, 2)).toBe("normal");
  expect(label({ ...costlyQuiet, attentionPct: 0.7, attentionShare: SCORE.quietShare }, 3)).toBe("normal");
});

test("one stray article in a few hundred still counts as quiet", () => {
  expect(label({ ...costlyQuiet, attentionPct: 0.7, attentionShare: 0.004 }, 1)).toBe("buried");
});

test("lobbying alone can make a section costly, an even-split dollar figure cannot", () => {
  expect(label({ ...costlyQuiet, dollarsMusd: null, lobbyingReports: 21 }, 0)).toBe("buried");
  expect(label({ ...costlyQuiet, dollarsMusd: null, lobbyingReports: 20 }, 0)).toBe("normal");
  expect(label({ ...costlyQuiet, dollarsSplit: "even_split" }, 0)).toBe("normal");
});

test("a loud, costly section is a headline, never buried", () => {
  const loud = { ...costlyQuiet, attentionPct: 0.95, attentionShare: 0.1 };
  expect(label(loud, SCORE.headlineMinHits)).toBe("headline");
  expect(label(loud, SCORE.headlineMinHits - 1)).toBe("normal");
});

test("a bill shorter than the minimum has nothing to bury a section among", () => {
  expect(label({ ...costlyQuiet, sections: SCORE.minSections - 1 }, 0)).toBe("normal");
  expect(label({ ...costlyQuiet, sections: SCORE.minSections }, 0)).toBe("buried");
});

test("a bill whose sections are not ranked has no buried label and no score", () => {
  const c = { ...costlyQuiet, attentionPct: null, attentionShare: null };
  expect(label(c, 0)).toBe("normal");
  expect(buried(c)).toBeNull();
});

test("the bundle's big-stakes bar is the score's costly bar", () => {
  const edge = (musd: number | null, reports: number) =>
    stakes({ dollarsMusd: musd, lobbyingReports: reports }) >= SCORE.costlyMin;
  expect(edge(BIG_STAKES.dollarsMusd, 0)).toBe(true);
  expect(edge(BIG_STAKES.dollarsMusd - 1, 0)).toBe(false);
  expect(edge(null, BIG_STAKES.reports)).toBe(true);
  expect(edge(null, BIG_STAKES.reports - 1)).toBe(false);
  expect(MIN_SECTIONS_TO_BURY).toBe(SCORE.minSections);
});

test("the late bonus shrinks smoothly as more of the bill arrives late, with no cutoff", () => {
  const base = { dollarsMusd: 10_000, attentionPct: 0, attentionShare: 0, late: true, offTopic: 0, lobbyingReports: 0 };
  const s = stakes(base);
  expect(buried({ ...base, lateShare: 0 })).toBeCloseTo(s * 1.25, 3);
  expect(buried({ ...base, lateShare: 0.4 })).toBeCloseTo(s * 1.15, 3);
  expect(buried({ ...base, lateShare: 0.5 })).toBeCloseTo(s * 1.125, 3);
  expect(buried({ ...base, lateShare: 1 })).toBeCloseTo(s, 3);
});

test("the same sections get the same label in a bill that is 49% late and one that is 51% late", () => {
  const c = { ...costlyQuiet, late: true };
  expect(label({ ...c, lateShare: 0.49 }, 0)).toBe("buried");
  expect(label({ ...c, lateShare: 0.51 }, 0)).toBe("buried");
  const gap = Math.abs(buried({ ...c, lateShare: 0.49 })! - buried({ ...c, lateShare: 0.51 })!);
  expect(gap).toBeLessThan(0.01);
});

test("off-topic distance raises the score only in a bill with one committee title", () => {
  const c = { ...costlyQuiet, offTopic: 0.98 };
  expect(buried({ ...c, titles: 1 })).toBeCloseTo(stakes(c) * 1.245, 3);
  expect(buried({ ...c, titles: 9 })).toBeCloseTo(stakes(c), 3);
});

test("the score never sees party: the same components give the same score for any bill", () => {
  const c = {
    dollarsMusd: 4000,
    attentionPct: 0.1,
    attentionShare: 0.001,
    late: true,
    offTopic: 0.7,
    lobbyingReports: 3,
  };
  expect(buried.length).toBe(1);
  expect(buried({ ...c })).toBe(buried({ ...c }));
});

test("percentile ranks every uncovered section at the bottom, ties included", () => {
  expect(percentile(0, [0, 0, 0, 1])).toBe(0);
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
  ({ id, outlet_id: outlet, text_chars: 2000, via: "mediacloud" }) as Row<"articles">;

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

test("articles too short to read are not counted, so paywalls cannot shrink one side", () => {
  const arts = [
    ...Array.from({ length: 12 }, (_, i) => article(`L${i}`, "rawstory.com")),
    ...Array.from({ length: 12 }, (_, i) => article(`R${i}`, "foxnews.com")),
    ...Array.from({ length: 40 }, (_, i) => ({ ...article(`P${i}`, "foxnews.com"), text_chars: 300 })),
  ];
  const matches: MatchRun["matches"] = {};
  for (const a of arts)
    matches[a.id] = { about: "bill", sections: a.id.startsWith("P") ? [] : ["a"], whole: false, outside: null };
  const run: MatchRun = { matcher: "t", model: "t", menuHash: "t", costUsd: 0, matches };
  const res = attention("119-hr-1", [section("a"), section("b")], arts, run);
  expect(res.share.get("a")).toBe(1);
  expect(res.relevant).toBe(24);
});

test("swapping the left and right outlets changes nothing", () => {
  const make = (leftOutlet: string, rightOutlet: string) => {
    const arts = [
      ...Array.from({ length: 15 }, (_, i) => article(`L${i}`, leftOutlet)),
      ...Array.from({ length: 15 }, (_, i) => article(`R${i}`, rightOutlet)),
    ];
    const matches: MatchRun["matches"] = {};
    for (const a of arts)
      matches[a.id] = {
        about: "bill",
        sections: a.id.startsWith("L") ? ["a", "b"] : ["a"],
        whole: false,
        outside: null,
      };
    const run: MatchRun = { matcher: "t", model: "t", menuHash: "t", costUsd: 0, matches };
    return attention("119-hr-1", [section("a"), section("b")], arts, run);
  };
  const one = make("rawstory.com", "foxnews.com");
  const two = make("foxnews.com", "rawstory.com");
  expect(two.share.get("b")).toBe(one.share.get("b")!);
  expect(two.rows.map((r) => r.pct)).toEqual(one.rows.map((r) => r.pct));
});

test("the share of a set of articles weighs each side equally, like a section's own share", () => {
  const arts = [
    ...Array.from({ length: 30 }, (_, i) => article(`L${i}`, "rawstory.com")),
    ...Array.from({ length: 10 }, (_, i) => article(`C${i}`, "thehill.com")),
    ...Array.from({ length: 10 }, (_, i) => article(`R${i}`, "foxnews.com")),
  ];
  const matches: MatchRun["matches"] = {};
  for (const a of arts)
    matches[a.id] = { about: "bill", sections: a.id === "L0" ? ["a"] : [], whole: false, outside: null };
  const run: MatchRun = { matcher: "t", model: "t", menuHash: "t", costUsd: 0, matches };
  const res = attention("119-hr-1", [section("a"), section("b")], arts, run);
  expect(res.shareOf(["L0"])).toBeCloseTo(res.share.get("a")!, 6);
  expect(res.shareOf(["L0", "R0"])).toBeCloseTo((1 / 30 + 1 / 10) / 3, 6);
  expect(res.shareOf([])).toBe(0);
  expect(res.counted.length).toBe(50);
});

const att = (section_id: string, over: Partial<Row<"attention">> = {}) =>
  ({
    id: `b:${section_id}`,
    section_id,
    hits: 0,
    pct: 0,
    evidence: { balanced_share: 0 },
    rests_on: [],
    ...over,
  }) as Row<"attention">;

test("a section the matcher missed but a direct check found in the coverage is no longer quiet", () => {
  const sections = Array.from(
    { length: 12 },
    (_, i) =>
      ({ ...section(`s${i}`), path: "title:I/sec:1", late: false, heading: "h", preview: "p" }) as Row<"sections">,
  );
  const est = {
    id: "e",
    per_section: true,
    baseline: "current-law",
    published_on: "2025-07-21",
  } as Row<"cbo_estimates">;
  const dollars = sectionDollars(
    [est],
    [line({ id: "x", section_ids: ["s0"], measure: "deficit", total_musd: 30_000 })],
  );
  const rows = (checks: Row<"attention_checks">[]) =>
    scoreRows(
      "119-hr-1",
      sections,
      sections.map((s) => att(s.id)),
      dollars,
      new Map(),
      new Map(),
      checks,
    );
  const missed = rows([]).find((r) => r.section_id === "s0")!;
  expect(missed.label).toBe("buried");
  expect(missed.attention_checked).toBeNull();
  const check = {
    id: "b:s0",
    section_id: "s0",
    article_ids: ["a1", "a2", "a3"],
    share: 0.03,
  } as Row<"attention_checks">;
  const found = rows([check]).find((r) => r.section_id === "s0")!;
  expect(found.label).toBe("normal");
  expect(found.attention_checked).toBe(3);
  expect(found.attention_share).toBe(0.03);
  expect(found.rests_on).toContain("attention_checks/b:s0");
  expect((found.evidence as { attention_hits: number }).attention_hits).toBe(3);
});
