import { expect, test } from "bun:test";
import { dollarScale } from "./dollars.ts";

test("no figures means no scale", () => {
  expect(dollarScale([])).toBeNull();
  expect(dollarScale([null, 0])).toBeNull();
});

test("rings are decades that cover the bill's own figures", () => {
  const s = dollarScale([150, -222_248, 79_600, null])!;
  expect(s.decades.map((d) => d.label)).toEqual(["$100M", "$1B", "$10B", "$100B", "$1T"]);
  expect(s.decades[0]!.t).toBe(0);
  expect(s.decades.at(-1)!.t).toBe(1);
});

test("never more than five decades, however small the smallest figure is", () => {
  const s = dollarScale([1, 2_000_000])!;
  expect(s.decades.length).toBe(6);
  expect(s.hiExp - s.loExp).toBe(5);
});

test("a bill whose figures share one decade still gets two rings", () => {
  const s = dollarScale([2000, 5000])!;
  expect(s.decades.length).toBe(2);
});

test("a longer bar is a bigger figure, a saving is measured by size, and a stub is the shortest", () => {
  const s = dollarScale([100, 10_000, -50_000])!;
  expect(s.length(10_000)).toBeGreaterThan(s.length(100));
  expect(s.length(-50_000)).toBeGreaterThan(s.length(10_000));
  expect(s.length(null)).toBeLessThanOrEqual(s.length(100));
  expect(s.length(-50_000)).toBe(s.length(50_000));
});

test("a figure below the smallest ring sits on the baseline instead of going negative", () => {
  const s = dollarScale([1, 5_000_000_000])!;
  expect(s.length(1)).toBe(s.length(null));
});
