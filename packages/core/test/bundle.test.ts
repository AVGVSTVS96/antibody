import { expect, test } from "bun:test";
import fixture from "../fixtures/genius-mini.bundle.json";
import { Bundle, BundleIndex, billStats, checkBundle } from "../src/bundle.ts";

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
    lobbyingReports: 757,
    companies: 1,
    membersTraded: 2,
    deficitMusd: 120,
    fingerprint: "u",
  });
});
