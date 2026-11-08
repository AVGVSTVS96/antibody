import { expect, test } from "bun:test";
import { parseBillId } from "@antibody/core";
import { CURATED } from "../src/curated.ts";

test("the curated list is party-balanced, alternating, with canonical unique ids", () => {
  const led = CURATED.map((p) => p.ledBy);
  expect(led.filter((p) => p === "R").length).toBe(led.filter((p) => p === "D").length);

  for (let i = 1; i < led.length; i++) {
    expect(led[i]).not.toBe(led[i - 1]);
  }

  for (const p of CURATED) {
    expect(parseBillId(p.id)).toBe(p.id);
  }

  expect(new Set(CURATED.map((p) => p.id)).size).toBe(CURATED.length);
  expect(CURATED.map((p) => p.id)).toContain("119-s-1582");
  expect(CURATED.map((p) => p.id)).toContain("119-hr-1");
  expect(CURATED.map((p) => p.id)).toContain("117-hr-5376");
});
