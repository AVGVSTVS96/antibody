import { expect, test } from "bun:test";
import type { Stage } from "@antibody/core";
import { order, register } from "../src/plan.ts";
import { PACKAGES } from "../src/registry.ts";

const stage = (name: string, needs: string[], writes: Stage["writes"] = []): Stage => ({
  name,
  scope: "bill",
  needs,
  writes,
  run: async () => {},
});

test("the real registry satisfies the contract", () => {
  expect(() => register(PACKAGES)).not.toThrow();
});

test("dependencies run first", () => {
  const all = register({
    "@antibody/ingest-bills": [stage("bills", [], ["sections"])],
    "@antibody/analyze": [stage("score", ["bills", "cbo"], ["section_scores"])],
    "@antibody/ingest-cbo": [stage("cbo", ["bills"], ["cbo_lines"])],
  });
  expect(order(all, ["score"]).map((s) => s.name)).toEqual(["bills", "cbo", "score"]);
});

test("a stage can only write tables its package owns", () => {
  expect(() => register({ "@antibody/analyze": [stage("x", [], ["trades"])] })).toThrow(
    /owned by @antibody\/ingest-trades/,
  );
});

test("cycles are caught", () => {
  const all = register({ "@antibody/analyze": [stage("a", ["b"]), stage("b", ["a"])] });
  expect(() => order(all, ["a"])).toThrow(/cycle/);
});
