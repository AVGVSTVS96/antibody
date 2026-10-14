import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Bundle } from "@antibody/core";
import { moneyPrinter } from "../src/land/format.ts";
import { extraDigits } from "../src/lib/sums.ts";
import { bigUsd, shownSum, usdPrinter } from "../src/story/data.ts";

test("a sentence's parts add up to its total, with decimals added only when they must", () => {
  const more = extraDigits(usdPrinter, (v, eq) => eq(v(100_700) + v(140_600), 241_300));
  expect(more).toBe(1);
  expect([bigUsd(100_700, more), bigUsd(140_600, more), bigUsd(241_300, more)]).toEqual([
    "$100.7B",
    "$140.6B",
    "$241.3B",
  ]);
  expect(extraDigits(usdPrinter, (v, eq) => eq(v(3_000) + v(5_000), 8_000))).toBe(0);
});

test("the landing's money format reads back the same way", () => {
  expect(extraDigits(moneyPrinter, (v, eq) => eq(v(100_700) + v(140_600), 241_300))).toBe(1);
});

test("zero has no unit", () => {
  expect(bigUsd(0)).toBe("$0");
  expect(bigUsd(0.2)).toBe("$0");
  expect(bigUsd(105)).toBe("$105M");
});

const dir = join(import.meta.dir, "../public/bundles");
const bundles = (() => {
  try {
    return readdirSync(dir).filter((f) => /^\d+-[a-z]+-\d+\.json$/.test(f));
  } catch {
    return [];
  }
})();

test.skipIf(!bundles.length)("on every real bundle the story's dollar parts add up to its totals", async () => {
  const { buildModel } = await import("../src/lib/model.ts");
  const { ch3 } = await import("../src/story/data.ts");
  let checked = 0;
  for (const f of bundles) {
    const data = ch3(buildModel(Bundle.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))))).data;
    if (!data.movement) continue;
    const { loud, quiet, other } = data.movement;
    const at = (m: number) => bigUsd(m, data.digits);
    const v = (m: number) => usdPrinter.value(m, data.digits);
    const total = shownSum(data.digits, data.added, data.cut);
    expect(total).toBe(bigUsd(v(data.added) + v(data.cut), data.digits));
    if (f.startsWith("117-hr-1319")) {
      expect(at(v(data.added) + v(data.cut))).toBe(at(data.added + data.cut));
      expect(at(v(loud) + v(quiet) + v(other))).toBe(total);
    }
    checked++;
  }
  expect(checked).toBeGreaterThanOrEqual(4);
});
