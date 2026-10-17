import { expect, test } from "bun:test";
import fixture from "../fixtures/genius-mini.bundle.json";
import { BIG_STAKES, Bundle, BundleIndex, billStats, checkBundle, headlineDeficit } from "../src/bundle.ts";

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
  expect(index.bills[0]).toMatchObject({ origin: "curated", note: null, addedOn: null });
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
      why: "the bill has only 1 section, too few for anything to be buried among",
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

function bill(n: number, over: (i: number) => object = () => ({})) {
  const b = structuredClone(Bundle.parse(fixture));
  const [only] = b.sections;
  const claim = Object.keys(b.claims)[0]!;
  b.sections = Array.from({ length: n }, (_, i) => ({
    ...only!,
    id: `s${i}`,
    path: `title:I/sec:${i + 1}`,
    inFinal: true,
    attention: { hits: 0, pct: 0, hitsByGroup: {}, tradeLegalHits: 0, examples: [], claim },
    score: null,
    ...over(i),
  }));
  return b;
}

const score = (dollarsMusd: number | null, lobbyingReports = 0) => ({
  label: "normal" as const,
  buried: null,
  components: {
    dollarsMusd,
    dollarsSplit: dollarsMusd === null ? null : ("exact" as const),
    attentionPct: 0,
    attentionShare: 0,
    late: false,
    offTopic: null,
    lobbyingReports,
  },
  claim: Object.keys(Bundle.parse(fixture).claims)[0]!,
});

test("the buried test cannot fire on a bill too short to bury anything in", () => {
  const t = billStats(bill(2)).buriedTest;
  expect(t.tested).toBe(false);
  expect(t.why).toBe("the bill has only 2 sections, too few for anything to be buried among");
});

test("the buried test cannot fire when the bill's sections are not ranked", () => {
  const t = billStats(bill(12, () => ({ attention: null }))).buriedTest;
  expect(t.tested).toBe(false);
  expect(t.why).toBe("too few news articles to rank this bill's sections");
});

test("the buried test cannot fire when no section has a measured cost, and says dollars were not measured", () => {
  const t = billStats(bill(12, () => ({ score: score(null) }))).buriedTest;
  expect(t.tested).toBe(false);
  expect(t.why).toContain("no section its own dollar figure");
  expect(t.dollarsMeasured).toBe(false);
});

test("the buried test fires once any section has a CBO figure, or enough lobbying reports", () => {
  const withDollars = billStats(bill(12, (i) => ({ score: score(i === 0 ? 500 : null) }))).buriedTest;
  expect(withDollars).toMatchObject({ tested: true, why: null, bigStakes: 0, dollarsMeasured: true });
  const withLobbying = billStats(
    bill(12, (i) => ({ score: score(null, i === 0 ? BIG_STAKES.reports : 0) })),
  ).buriedTest;
  expect(withLobbying).toMatchObject({ tested: true, why: null, bigStakes: 1, dollarsMeasured: false });
  const big = billStats(bill(12, (i) => ({ score: score(i === 0 ? -BIG_STAKES.dollarsMusd : null) }))).buriedTest;
  expect(big.bigStakes).toBe(1);
});

test("an appropriations act's deficit is marked as direct spending and revenue only", () => {
  const b = structuredClone(Bundle.parse(fixture));
  b.bill.title = "Consolidated Appropriations Act, 2023";
  b.bill.shortTitle = null;
  expect(billStats(b).deficitDirectOnly).toBe(true);
});
