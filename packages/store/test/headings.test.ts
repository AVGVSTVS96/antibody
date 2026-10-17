import { expect, test } from "bun:test";
import { firstWords } from "../src/build.ts";

test("a section the bill leaves unnamed is listed by its opening words, without the subsection marker", () => {
  expect(firstWords("(a) None of the funds made available in this Act may be used to alter operations")).toBe(
    "None of the funds made available in this Act may…",
  );
  expect(firstWords("(a) (1) No Federal funds made available for this fiscal year")).toBe(
    "No Federal funds made available for this fiscal year",
  );
  expect(firstWords("SEC. 202. Funding made available under the headings")).toBe(
    "Funding made available under the headings",
  );
});

test("a marker that is part of the sentence stays, and an empty section says so", () => {
  expect(firstWords("(g) of the Richard B. Russell National School Lunch Act")).toBe(
    "(g) of the Richard B. Russell National School Lunch Act",
  );
  expect(firstWords("")).toBe("(no heading)");
});
