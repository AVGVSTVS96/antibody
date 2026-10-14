import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { count } from "../src/lib/format.ts";
import { mostNamed } from "../src/story/data.ts";

const src = join(import.meta.dir, "../src");
const NOUNS =
  "stocks|companies|trades|clients|members|articles|reports|filings|sections|records|claims|months|days|donors|mentions|marks|lobbyists|estimates|amendments|firms|votes|ties|gifts|PACs|ARTICLES|REPORTS|TRADES|FILINGS|SECTIONS|CLIENTS";
const SIZED = new RegExp(`(?:\\$\\{|\\{)[^{}]*\\.(?:length|size)\\}\\s+(?:[a-z-]+ )?(?:${NOUNS})\\b`);
const CAPS = /\}\s+(?:ARTICLES|REPORTS|TRADES|FILINGS|CLIENTS)\b/;

/** Counts that cannot be 1 by construction: a month series, a list shown only past a threshold. */
const FINE = [
  "all {everyone.length} months",
  "All {everyone.length} months",
  "show all $" + "{rows.length} stocks",
  "monthly(book).length : 0} months",
  "m.sections.filter((v) => v.s.inFinal).length} sections by dollars",
];

/** A line (or the two before it) that already picks its wording by the count, or prints a total that is a sample size. */
const GUARDED = /=== 1\b|toLocaleString/;
const guardedBy = (lines: string[], i: number) => lines.slice(Math.max(i - 2, 0), i + 1).some((l) => GUARDED.test(l));

const files = (readdirSync(src, { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f));

test("a number that counts a list never meets a plural noun without count()", () => {
  const bad: string[] = [];
  for (const f of files) {
    const lines = readFileSync(join(src, f), "utf8").split("\n");
    lines.forEach((line, i) => {
      if ((SIZED.test(line) || CAPS.test(line)) && !guardedBy(lines, i) && !FINE.some((ok) => line.includes(ok)))
        bad.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  expect(bad).toEqual([]);
});

test("count() singularizes only 1", () => {
  expect(count(1, "client")).toBe("1 client");
  expect(count(0, "client")).toBe("0 clients");
  expect(count(2, "company", "companies")).toBe("2 companies");
  expect(count(1234, "trade")).toBe("1,234 trades");
});

test("the most-named sections read right for 1, all and some", () => {
  expect(mostNamed(1, 1)).toBe("The most-named section");
  expect(mostNamed(3, 3)).toBe("All 3 most-named sections");
  expect(mostNamed(1, 3)).toBe("1 of the 3 most-named sections");
});
