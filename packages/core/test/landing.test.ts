import { expect, test } from "bun:test";
import fixture from "../fixtures/genius-mini.bundle.json";
import { type BillStats, Bundle, billStats } from "../src/bundle.ts";
import { landingOrder } from "../src/landing.ts";

const tested = { tested: true, why: null, bigStakes: 0, dollarsMeasured: true };
const base = { ...billStats(Bundle.parse(fixture)), buriedTest: tested };
const bill = (id: string, stats: Partial<BillStats> | null, latestActionOn = "2025-01-01") => ({
  id,
  latestActionOn,
  stats: stats && { ...base, ...stats },
});
const untested = { tested: false, why: "x", bigStakes: 0, dollarsMeasured: true };

test("tested bills come first, then more quiet sections, then more lobbying reports, then the newest", () => {
  const order = landingOrder([
    bill("new-small", { buried: 0, lobbyingReports: 5 }, "2025-12-01"),
    bill("untested-huge", { buried: 0, lobbyingReports: 99_999, buriedTest: untested }),
    bill("old-big", { buried: 0, lobbyingReports: 900 }, "2021-01-01"),
    bill("two-quiet", { buried: 2, lobbyingReports: 1 }),
    bill("new-big", { buried: 0, lobbyingReports: 900 }, "2023-01-01"),
  ]);
  expect(order.map((b) => b.id)).toEqual(["two-quiet", "new-big", "old-big", "new-small", "untested-huge"]);
});

test("a bill with no stats is left out", () => {
  expect(landingOrder([bill("a", null), bill("b", {})]).map((b) => b.id)).toEqual(["b"]);
});
