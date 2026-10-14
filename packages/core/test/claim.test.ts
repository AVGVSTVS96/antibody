import { expect, test } from "bun:test";
import { Claim } from "../src/claim.ts";

const fact = {
  id: "trades/20032256#1",
  text: "Rep. Tim Moore (R-NC) bought Coinbase (COIN) stock worth $15,001-$50,000 on Sep 11, 2025.",
  kind: "fact",
  sourceUrl: "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2025/20032256.pdf",
  sourceLocator: "page 1, row 1",
  archiveUrl: null,
  quote: null,
  confidence: 1,
  restsOn: [],
  rule: null,
} as const;

test("a fact with a specific record passes", () => {
  expect(Claim.safeParse(fact).success).toBe(true);
});

test("a stub URL is rejected", () => {
  const r = Claim.safeParse({ ...fact, sourceUrl: "https://efdsearch.senate.gov/search/view/ptr/" });
  expect(r.success).toBe(false);
});

test("an inference names its rule and what it rests on", () => {
  const inf = { ...fact, id: "benefits/x", kind: "inference", confidence: 0.8 };
  expect(Claim.safeParse(inf).success).toBe(false);
  expect(Claim.safeParse({ ...inf, rule: "tied-stock", restsOn: ["lda_bill_refs/a"] }).success).toBe(true);
});
