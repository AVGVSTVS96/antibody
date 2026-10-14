import { expect, test } from "bun:test";
import { earlierBill } from "../src/eras.ts";

test("lobbying on H.R.5376 before the Senate rewrote it, or under its old name, is the Build Back Better Act", () => {
  expect(earlierBill("117-hr-5376", "2022-03-31", "H.R. 5376 child care")).toContain("Build Back Better");
  expect(earlierBill("117-hr-5376", "2023-03-31", "Build Back Better paid leave, H.R. 5376")).toContain(
    "calls it the Build Back Better Act",
  );
});

test("lobbying after the rewrite counts, and so does a line that names the Inflation Reduction Act beside the old name", () => {
  expect(earlierBill("117-hr-5376", "2022-09-30", "Inflation Reduction Act, H.R. 5376")).toBeNull();
  expect(
    earlierBill("117-hr-5376", "2022-09-30", "Build Back Better / Inflation Reduction Act tax credits"),
  ).toBeNull();
});

test("other bills are never held out for their era", () => {
  expect(earlierBill("119-s-1582", "2021-03-31", "Build Back Better")).toBeNull();
});
