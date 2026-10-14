import { expect, test } from "bun:test";
import { searchable } from "../src/pull.ts";

test("a name with a word starting 'Admin' is searched by its longest stretch without it (lda.gov answers 403 to the word)", () => {
  expect(searchable("National Aeronautics and Space Administration Authorization")).toBe(
    "National Aeronautics and Space",
  );
  expect(searchable("Administrative Pay-As-You-Go Act")).toBe("Pay-As-You-Go Act");
  expect(searchable("Social Security Administration")).toBe("Social Security");
  expect(searchable("Administration")).toBeNull();
  expect(searchable("Fiscal Responsibility Act")).toBe("Fiscal Responsibility Act");
});
