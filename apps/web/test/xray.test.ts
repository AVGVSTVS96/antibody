import { expect, test } from "bun:test";
import { Bundle } from "@antibody/core";
import genius from "../fixtures/119-s-1582.bundle.json";
import { buildModel } from "../src/lib/model.ts";
import { buildTape, type TapeRow } from "../src/lib/tape.ts";
import {
  baselines,
  commonPlace,
  contrast,
  counts,
  csv,
  leanOf,
  months,
  passages,
  passageText,
  select,
  signed,
  years,
} from "../src/xray/derive.ts";
import { xTicks } from "../src/xray/Gap.tsx";
import { pile, swarm } from "../src/xray/swarm.ts";

const fresh = () => Bundle.parse(structuredClone(genius));
const tapeOf = (b: Bundle) => buildTape(buildModel(b));

const row = (over: Partial<TapeRow>): TapeRow =>
  ({
    index: 0,
    kind: "other",
    musd: null,
    evenSplit: false,
    late: false,
    articles: 0,
    lobbying: 0,
    ...over,
  }) as TapeRow;

test("the head's sentence names each chamber's passage vote and skips procedural ones", () => {
  const b = fresh();
  expect(passageText(passages(b.votes))).toBe(
    "The Senate passed it 68–30 on Jun 17, 2025, and the House passed it 308–122 on Jul 17, 2025.",
  );
  b.votes.push({
    ...b.votes[0]!,
    id: "x",
    number: 9,
    question: "On the Motion to Commit S. 1582",
    result: "Motion Rejected",
  });
  expect(passages(b.votes)).toHaveLength(2);
});

test("a vice president's tie-break and a concurrence are said as they happened", () => {
  const text = passageText([
    { chamber: "Senate", date: "2025-07-01", yeas: 50, nays: 50, concur: false, tie: true, claim: "a" },
    { chamber: "House", date: "2025-07-03", yeas: 218, nays: 214, concur: true, tie: false, claim: "b" },
  ]);
  expect(text).toBe(
    "The Senate passed it 50–50 on Jul 1, 2025 (the Vice President broke the tie), and the House concurred 218–214 on Jul 3, 2025.",
  );
});

test("a baseline appears only when CBO published a whole-bill figure on it", () => {
  const found = baselines(fresh());
  expect(found.map((x) => x.baseline)).toEqual(["current-law"]);
  expect(found[0]!.estimate.baselineLabel).toBe("CBO current-law baseline");
  const none = fresh();
  none.dollars.wholeBill = [];
  expect(baselines(none)).toEqual([]);
});

test("filters count the same rows they list, and the late filter is empty without late flags", () => {
  const t = tapeOf(fresh());
  const tally = counts(t.rows);
  expect(tally).toMatchObject({ all: 20, loud: 3, quiet: 1, late: 1 });
  for (const f of ["all", "loud", "quiet", "late", "lobbied"] as const)
    expect(select(t.rows, f, "order")).toHaveLength(tally[f]);
});

test("sorts put the biggest first and unmeasured last, ties in bill order", () => {
  const rows = [
    row({ index: 0, musd: 5, articles: 1 }),
    row({ index: 1, musd: -90, articles: null }),
    row({ index: 2, musd: null, articles: 9 }),
    row({ index: 3, musd: 5, articles: 1 }),
  ];
  expect(select(rows, "all", "cost").map((r) => r.index)).toEqual([1, 0, 3, 2]);
  expect(select(rows, "all", "news").map((r) => r.index)).toEqual([2, 0, 3, 1]);
});

test("the contrast pair is the closest exact figures of one sign, a loud and a quiet section", () => {
  const rows = [
    row({ index: 0, kind: "headline", musd: 31_700 }),
    row({ index: 1, kind: "headline", musd: -29_000 }),
    row({ index: 2, kind: "headline", musd: 900, evenSplit: true }),
    row({ index: 3, kind: "quiet", musd: 29_700 }),
    row({ index: 4, kind: "quiet", musd: 700 }),
  ];
  const pair = contrast(rows)!;
  expect([pair.loud.index, pair.quiet.index]).toEqual([0, 3]);
  expect(contrast(rows.filter((r) => r.kind !== "quiet"))).toBeNull();
  expect(contrast(rows.map((r) => ({ ...r, evenSplit: true })))).toBeNull();
});

test("outlet lean sums the sections' matches and keeps whole-bill articles apart", () => {
  const b = fresh();
  const lean = leanOf(b);
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, n) => a + n, 0);
  const hits = b.sections
    .filter((s) => s.inFinal)
    .reduce((n, s) => n + Object.values(s.attention?.hitsByGroup ?? {}).reduce((a, x) => a + x, 0), 0);
  expect(sum(lean.sections)).toBe(hits);
  expect(sum(lean.general)).toBe(Object.values(b.attention.general?.hitsByGroup ?? {}).reduce((a, x) => a + x, 0));
});

test("figures print the way the boards do", () => {
  expect(signed(29_700)).toBe("+$29.7B");
  expect(signed(-366_441)).toBe("−$366B");
  expect(signed(3_394_444)).toBe("+$3.39T");
  expect(signed(150)).toBe("+$150M");
  expect(signed(0)).toBe("$0");
  expect(years("2025-2034")).toBe("10 YR");
  expect(months(["2025-05-01", "2025-08-01"])).toBe("May–Aug 2025");
  expect(months(["2024-12-01", "2025-02-01"])).toBe("Dec 2024–Feb 2025");
  expect(commonPlace(["Title VII", "Subtitle A", "Chapter 3"], ["Title VII", "Subtitle A", "Chapter 4"])).toEqual([
    "Title VII",
    "Subtitle A",
  ]);
});

test("the CSV names each figure's baseline, quotes commas and marks unknown late flags", () => {
  const b = fresh();
  b.sections[0]!.heading = 'Short "title", and more';
  const t = tapeOf(b);
  const first = csv(t.rows.slice(0, 1), t).split("\n");
  expect(first[0]).toContain("cbo_baseline");
  expect(first[1]).toContain('"Short ""title"", and more"');
  b.bill.lateUnavailable = "shell";
  const shell = tapeOf(b);
  expect(csv(shell.rows.slice(0, 1), shell).split("\n")[1]).toContain(",unknown,");
});

test("a beeswarm keeps every y, touches nothing and stays between its walls", () => {
  const pts = Array.from({ length: 50 }, (_, i) => ({ cx: 100, y: 50 + (i % 7) * 3, lo: 20, hi: 180 }));
  const r = 3;
  const xs = swarm(pts, r);
  for (let i = 0; i < pts.length; i++) {
    expect(xs[i]).toBeGreaterThanOrEqual(20);
    expect(xs[i]).toBeLessThanOrEqual(180);
    for (let j = 0; j < i; j++) {
      const d = Math.hypot(xs[i]! - xs[j]!, pts[i]!.y - pts[j]!.y);
      expect(d).toBeGreaterThanOrEqual(2 * r - 0.01);
    }
  }
});

test("a full beeswarm column overlaps instead of leaving its walls", () => {
  const xs = swarm(
    Array.from({ length: 30 }, () => ({ cx: 50, y: 10, lo: 40, hi: 60 })),
    3,
  );
  expect(Math.min(...xs)).toBeGreaterThanOrEqual(40);
  expect(Math.max(...xs)).toBeLessThanOrEqual(60);
});

test("a pile packs rows inside its width and rises from the base", () => {
  const dots = pile(25, 100, 40, 200, 3);
  expect(dots).toHaveLength(25);
  expect(Math.min(...dots.map(([x]) => x))).toBeGreaterThanOrEqual(100 - 22);
  expect(Math.max(...dots.map(([x]) => x))).toBeLessThanOrEqual(100 + 22);
  expect(Math.max(...dots.map(([, y]) => y))).toBe(200);
  expect(Math.min(...dots.map(([, y]) => y))).toBeLessThan(200);
});

test("article ticks end on the largest count and stay few", () => {
  expect(xTicks(4)).toEqual([1, 2, 3, 4]);
  expect(xTicks(24)).toEqual([1, 5, 10, 15, 20, 24]);
  expect(xTicks(242)).toEqual([1, 50, 100, 150, 200, 242]);
  expect(xTicks(1)).toEqual([1]);
});
