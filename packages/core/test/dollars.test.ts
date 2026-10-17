import { expect, test } from "bun:test";
import { type FigureEstimate, type FigureLine, figureEstimates, sectionFigure } from "../src/dollars.ts";

const est = (id: string, baseline: FigureEstimate["baseline"], over: Partial<FigureEstimate> = {}): FigureEstimate => ({
  id,
  baseline,
  publishedOn: "2025-07-21",
  perSection: true,
  versionScored: "Public Law 119-21",
  ...over,
});
const line = (estimateId: string, amountMusd: number, over: Partial<FigureLine> = {}): FigureLine => ({
  estimateId,
  measure: "deficit",
  amountMusd,
  split: "exact",
  claim: `${estimateId}:line`,
  ...over,
});

const pair = [est("law", "current-law"), est("policy", "current-policy")];

test("a section CBO printed against two baselines counts at the smaller figure, and both are kept", () => {
  const f = sectionFigure([line("law", 1_362_810), line("policy", -12_164)], pair)!;
  expect(f).toMatchObject({ musd: -12_164, baseline: "current-policy", estimateId: "policy", fromLatest: true });
  expect(f.byBaseline.map((b) => [b.baseline, b.musd])).toEqual([
    ["current-law", 1_362_810],
    ["current-policy", -12_164],
  ]);
});

test("the smaller figure counts whichever baseline it is on", () => {
  expect(sectionFigure([line("law", 5_000), line("policy", 40_000)], pair)).toMatchObject({
    musd: 5_000,
    baseline: "current-law",
  });
});

test("a bill with one baseline counts its figure as printed", () => {
  const f = sectionFigure([line("law", 1_362_810)], [pair[0]!])!;
  expect(f).toMatchObject({ musd: 1_362_810, baseline: "current-law" });
  expect(f.byBaseline).toHaveLength(1);
});

test("a baseline that does not list the section is left out, not read as zero", () => {
  const f = sectionFigure([line("law", 1_362_810)], pair)!;
  expect(f.musd).toBe(1_362_810);
  expect(f.byBaseline.map((b) => b.baseline)).toEqual(["current-law"]);
});

test("an even share of a group line counts only when no baseline has an exact figure", () => {
  const split = line("policy", 90_000, { split: "even_split" });
  expect(sectionFigure([line("law", 20_000), split], pair)).toMatchObject({ musd: 20_000, split: "exact" });
  expect(sectionFigure([split], pair)).toMatchObject({ musd: 90_000, split: "even_split" });
});

test("estimates of different text are not read together", () => {
  const senate = [
    est("law-enacted", "current-law"),
    est("policy-senate", "current-policy", { publishedOn: "2025-06-29", versionScored: "As posted on June 27, 2025" }),
  ];
  const f = sectionFigure([line("law-enacted", 100_000), line("policy-senate", 500)], senate)!;
  expect(f).toMatchObject({ musd: 100_000, baseline: "current-law" });
  expect(f.byBaseline).toHaveLength(1);
  expect(figureEstimates(senate).map((e) => e.id)).toEqual(["law-enacted"]);
});

test("a section dropped before the final text keeps the figure of the last estimate that listed it", () => {
  const chain = [est("old", "current-law", { publishedOn: "2025-06-04" }), est("law", "current-law")];
  const f = sectionFigure([line("old", 7_000)], chain)!;
  expect(f).toMatchObject({ musd: 7_000, estimateId: "old", fromLatest: false });
});

test("only per-section estimates supply figures", () => {
  expect(figureEstimates([est("whole", "current-law", { perSection: false }), ...pair]).map((e) => e.id)).toEqual([
    "law",
    "policy",
  ]);
});
