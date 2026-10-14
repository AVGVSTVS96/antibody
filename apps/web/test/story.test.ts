import { expect, test } from "bun:test";
import { Bundle } from "@antibody/core";
import genius from "../fixtures/119-s-1582.bundle.json";
import { buildModel } from "../src/lib/model.ts";
import { bigUsd, ch1, ch2, ch5, figure, glue } from "../src/story/data.ts";

const untested = () => {
  const b = Bundle.parse(structuredClone(genius));
  for (const s of b.sections) {
    if (s.attention) s.attention.pct = null;
    if (s.score?.label === "buried") s.score.label = "normal";
  }
  return buildModel(b);
};

test("a bill the rule could not run on says so, with why, where a chapter would state a quiet-section result", () => {
  const m = untested();
  const why = "too few news articles to rank this bill's sections";
  const first = ch1(m).data.handoff;
  expect(first.value).toBe("—");
  expect(first.text).toContain(`We couldn't test this bill for quiet sections: ${why}`);
  const second = ch2(m);
  expect(second.head.map((l) => l.text).join(" ")).toBe("We couldn't test this bill for quiet sections.");
  expect(second.lede).toContain(why);
  expect(second.data.closest).toBeNull();
  const fifth = ch5(m);
  expect(fifth.head.map((l) => l.text).join(" ")).toMatch(/^\d+ listed compan(y|ies) lobbied on this bill\.$/);
  expect(fifth.lede).toContain("We couldn't test for quiet sections");
  expect(fifth.lede).toContain(why);
});

test("a tested bill keeps its quiet-section result", () => {
  const m = buildModel(Bundle.parse(genius));
  expect(ch1(m).data.handoff.value).toMatch(/^\d+$/);
  expect(
    ch2(m)
      .head.map((l) => l.text)
      .join(" "),
  ).toContain("section");
  expect(
    ch2(m)
      .head.map((l) => l.text)
      .join(" "),
  ).not.toContain("couldn't");
});

test("money has one format: three digits at most, the sign spelled out where it matters", () => {
  expect(bigUsd(3_394_000)).toBe("$3.39T");
  expect(bigUsd(-241_300)).toBe("$241B");
  expect(bigUsd(12_540)).toBe("$12.5B");
  expect(bigUsd(999)).toBe("$999M");
  expect(figure(-12_540)).toBe("−$12.5B");
  expect(figure(3_394_000)).toBe("+$3.39T");
});

test("digits joined by a hyphen never split across lines", () => {
  expect(glue("2023-2032 and P.L. 117-169")).toBe("2023‑2032 and P.L. 117‑169");
  expect(glue("a well-known bill")).toBe("a well-known bill");
});
