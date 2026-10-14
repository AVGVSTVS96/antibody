import { expect, test } from "bun:test";
import fixture from "../fixtures/genius-mini.bundle.json";
import { Bundle, BundleIndex, billStats, checkBundle, headlineDeficit } from "../src/bundle.ts";

test("the fixture is a valid, sound bundle", () => {
  const parsed = Bundle.safeParse(fixture);
  if (!parsed.success) throw new Error(parsed.error.message);
  expect(checkBundle(parsed.data)).toEqual([]);
});

test("checkBundle catches a dangling claim and edge", () => {
  const b = Bundle.parse(fixture);
  const broken = structuredClone(b);
  broken.edges.push({ ...b.edges[0]!, id: "x", dst: "member:NOPE", claims: ["trades/missing"] } as never);
  expect(checkBundle(broken)).toEqual([
    "edge x: unknown dst member:NOPE",
    ".edges[4].claims: unknown claim trades/missing",
  ]);
});

test("an index without stats or watch picks still parses", () => {
  const index = BundleIndex.parse({
    generatedAt: "2026-10-13T21:00:00-07:00",
    bills: [
      {
        id: "119-s-1582",
        display: "S.1582",
        title: "GENIUS Act",
        shortTitle: null,
        law: null,
        sponsorParty: "R",
        latestActionOn: null,
        file: "119-s-1582.json",
      },
    ],
  });
  expect(index.watch).toEqual([]);
  expect(index.bills[0]!.stats).toBeNull();
});

test("billStats counts the index card numbers", () => {
  expect(billStats(Bundle.parse(fixture))).toEqual({
    sections: 1,
    headline: 0,
    buried: 0,
    late: 1,
    tally: null,
    lobbyingReports: 757,
    companies: 1,
    membersTraded: 2,
    membersTradedDuring: expect.any(Number),
    buriedTest: {
      tested: false,
      why: "too few news articles to rank this bill's sections",
      bigStakes: 0,
      dollarsMeasured: false,
    },
    cboPublished: true,
    deficitDirectOnly: false,
    tradeSpan: expect.anything(),
    lateShare: expect.any(Number),
    vehicle: false,
    deficitMusd: 120,
    fingerprint: "u",
  });
});

test("the headline deficit comes from the latest published estimate, longest period", () => {
  const b = structuredClone(Bundle.parse(fixture));
  const base = b.dollars.wholeBill.find((d) => d.measure === "deficit")!;
  const est = b.dollars.estimates[0]!;
  b.dollars.estimates = [
    { ...est, id: "old", publishedOn: "2025-06-04" },
    { ...est, id: "new", publishedOn: "2025-07-21" },
  ];
  b.dollars.wholeBill = [
    { ...base, estimateId: "old", period: "2025-2034", amountMusd: 2416229 },
    { ...base, estimateId: "new", period: "2025-2029", amountMusd: 1 },
    { ...base, estimateId: "new", period: "2025-2034", amountMusd: 3394444 },
  ];
  expect(headlineDeficit(b, "current-law")?.amountMusd).toBe(3394444);
  expect(headlineDeficit(b, "current-policy")).toBeUndefined();
});

test("checkBundle also follows *Claim props, like a lobbied edge's shareClaim", () => {
  const b = Bundle.parse(fixture);
  const broken = structuredClone(b);
  broken.edges.push({
    id: "lobbied:x",
    kind: "lobbied",
    src: b.edges[0]!.src,
    dst: b.edges[0]!.dst,
    basis: "fact",
    claims: [b.edges[0]!.claims[0]!],
    props: {
      reports: 1,
      quarters: 1,
      phases: { bill: 1, enactmentQuarter: 0, law: 0 },
      spendTotalUsd: null,
      shareEstimateUsd: 1,
      shareClaim: "lda_spend/missing#share",
      issueQuote: null,
      topicOnly: false,
    },
  });
  expect(checkBundle(broken)).toEqual([".edges[4].props.shareClaim: unknown claim lda_spend/missing#share"]);
});

test("the buried test cannot fire on a multi-title bill with no late flag, and says dollars were not measured", () => {
  const b = structuredClone(Bundle.parse(fixture));
  const [only] = b.sections;
  b.sections = [
    { ...only!, id: "a", path: "title:I/sec:1", inFinal: true },
    { ...only!, id: "b", path: "title:II/sec:2", inFinal: true },
  ].map((s) => ({
    ...s,
    attention: {
      hits: 1,
      pct: 0.5,
      hitsByGroup: {},
      tradeLegalHits: 0,
      examples: [],
      claim: Object.keys(b.claims)[0]!,
    },
  }));
  b.bill.lateUnavailable = "began as a shell";
  const t = billStats(b).buriedTest;
  expect(t.tested).toBe(false);
  expect(t.why).toContain("several committee titles");
  expect(t.dollarsMeasured).toBe(false);
});

test("an appropriations act's deficit is marked as direct spending and revenue only", () => {
  const b = structuredClone(Bundle.parse(fixture));
  b.bill.title = "Consolidated Appropriations Act, 2023";
  b.bill.shortTitle = null;
  expect(billStats(b).deficitDirectOnly).toBe(true);
});
