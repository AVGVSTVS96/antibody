import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { count } from "../src/lib/format.ts";

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

/** A line that already picks its wording by the count, or prints a total that is a sample size. */
const GUARDED = /=== 1 \?|toLocaleString/;

const files = (readdirSync(src, { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f));

test("a number that counts a list never meets a plural noun without count()", () => {
  const bad: string[] = [];
  for (const f of files)
    readFileSync(join(src, f), "utf8")
      .split("\n")
      .forEach((line, i) => {
        if ((SIZED.test(line) || CAPS.test(line)) && !GUARDED.test(line) && !FINE.some((ok) => line.includes(ok)))
          bad.push(`${f}:${i + 1}: ${line.trim()}`);
      });
  expect(bad).toEqual([]);
});

test("count() singularizes only 1", () => {
  expect(count(1, "client")).toBe("1 client");
  expect(count(0, "client")).toBe("0 clients");
  expect(count(2, "company", "companies")).toBe("2 companies");
  expect(count(1234, "trade")).toBe("1,234 trades");
});
