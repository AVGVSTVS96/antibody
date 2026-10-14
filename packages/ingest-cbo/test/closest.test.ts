import { expect, test } from "bun:test";
import type { Row } from "@antibody/core";
import { closestVersion } from "../src/sections.ts";

const section = (id: string, history: Record<string, string>) =>
  ({
    id,
    history: Object.fromEntries(Object.entries(history).map(([v, n]) => [v, { path: `sec:${n}` }])),
  }) as unknown as Row<"sections">;

const sections = [1, 2, 3, 4, 5, 6].map((n) => section(`s${n}`, { eas: `${n}0`, enr: `${n}00` }));

test("CBO numbers join to the published version that numbers nearly all of them the same way", () => {
  expect(closestVersion(sections, ["100", "200", "300", "400", "500", "600"], ["eas", "enr"])).toEqual({
    code: "enr",
    covered: 6,
  });
});

test("a version covering too few of CBO's numbers is not used, and neither is a handful of numbers", () => {
  expect(closestVersion(sections, ["100", "200", "300", "999", "998", "997"], ["eas", "enr"])).toBeNull();
  expect(closestVersion(sections, ["100", "200"], ["enr"])).toBeNull();
});
