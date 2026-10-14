import { expect, test } from "bun:test";
import { bigUsd, bigUsdSum } from "../src/story/data.ts";

test("a sentence's parts add up to its rounded total", () => {
  expect(bigUsd(312_400)).toBe("$312B");
  expect(bigUsd(105)).toBe("$105M");
  expect(bigUsdSum(312_400, 105)).toBe("$312B");
  expect(bigUsdSum(101_400, 141_400)).toBe("$242B");
});

test("zero has no unit", () => {
  expect(bigUsd(0)).toBe("$0");
  expect(bigUsd(0.2)).toBe("$0");
});
