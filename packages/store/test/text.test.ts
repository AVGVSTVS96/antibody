import { expect, test } from "bun:test";
import { day, lawNumber, memberLabel, musd, quarter, usd } from "../src/text.ts";

test("claim wording helpers", () => {
  expect(day("2025-07-18")).toBe("July 18, 2025");
  expect(day(null)).toBe("an unknown date");
  expect([120, 1200, 944_000, -120].map(musd)).toEqual([
    "$120 million",
    "$1.2 billion",
    "$944 billion",
    "$120 million",
  ]);
  expect([5000, 18_700_000].map(usd)).toEqual(["$5,000", "$18.7 million"]);
  expect(memberLabel({ name: "Bill Hagerty", party: "R", state: "TN", chamber: "Senate" })).toBe(
    "Sen. Bill Hagerty (R-TN)",
  );
  expect(memberLabel({ name: "Gil Cisneros", party: "D", state: "CA", chamber: "House" })).toBe(
    "Rep. Gil Cisneros (D-CA)",
  );
  expect(["first_quarter", "mid_year", "year_end"].map(quarter)).toEqual([
    "Q1",
    "the mid-year period",
    "the year-end period",
  ]);
  expect(["P.L. 119-27", "119-27", "Public Law 119-27"].map(lawNumber)).toEqual(["119-27", "119-27", "119-27"]);
});
