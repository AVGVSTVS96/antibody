import { expect, test } from "bun:test";
import { nameMatches, reusedTicker } from "../src/trades.ts";

test("COR as CoreSite or CNR as Cornerstone is not Cencora or Core Natural Resources", () => {
  expect(reusedTicker("COR", "CoreSite Realty Corporation Common Stock")).toBe(true);
  expect(reusedTicker("CNR", "Cornerstone Building Brands, Inc.")).toBe(true);
  expect(reusedTicker("COR", "Cencora, Inc. Common Stock (COR) [ST]")).toBe(false);
});

test("names match across suffixes and spellings, and differ for another company", () => {
  expect(nameMatches("Apple Inc. - Common Stock (AAPL) [ST]", "Apple Inc.")).toBe(true);
  expect(nameMatches("Exxon Mobil Corporation (XOM) [ST]", "ExxonMobil Holdings Corp")).toBe(false);
  expect(nameMatches("CoreSite Realty Corporation Common Stock", "Cencora, Inc.")).toBe(false);
  expect(nameMatches("MU CALL", "Micron Technology, Inc.")).toBe(true);
});
