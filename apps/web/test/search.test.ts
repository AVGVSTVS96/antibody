import { expect, test } from "bun:test";
import { Bundle, type BundleIndex } from "@antibody/core";
import genius from "../fixtures/119-s-1582.bundle.json";
import { buildModel } from "../src/lib/model.ts";
import { missingBill, searchBills, searchSections } from "../src/lib/search.ts";

const bill = (id: string, display: string, shortTitle: string | null, title: string, on: string) =>
  ({ id, display, shortTitle, title, law: null, latestActionOn: on }) as BundleIndex["bills"][number];

const bills = [
  bill("119-hr-1", "H.R.1", "One Big Beautiful Bill Act", "A bill to provide for reconciliation", "2025-07-04"),
  bill(
    "119-s-1582",
    "S.1582",
    "GENIUS Act",
    "A bill to provide for the regulation of payment stablecoins",
    "2025-07-18",
  ),
  bill(
    "117-hr-1319",
    "H.R.1319",
    "American Rescue Plan Act of 2021",
    "A bill to provide for reconciliation",
    "2021-03-11",
  ),
  bill(
    "117-hr-5376",
    "H.R.5376",
    "Inflation Reduction Act of 2022",
    "A bill to provide for reconciliation",
    "2022-08-16",
  ),
  bill("118-hr-1", "H.R.1", null, "Lower Energy Costs Act", "2023-03-30"),
];

test("bills by number, any way it is typed", () => {
  expect(searchBills(bills, "S.1582").map((b) => b.id)[0]).toBe("119-s-1582");
  expect(searchBills(bills, "s 1582").map((b) => b.id)[0]).toBe("119-s-1582");
  expect(searchBills(bills, "119-s-1582").map((b) => b.id)[0]).toBe("119-s-1582");
  expect(searchBills(bills, "https://www.congress.gov/bill/119th-congress/senate-bill/1582").map((b) => b.id)[0]).toBe(
    "119-s-1582",
  );
});

test("a number without a congress finds it in every congress, newest first, exact before longer numbers", () => {
  expect(searchBills(bills, "H.R. 1").map((b) => b.id)).toEqual(["119-hr-1", "118-hr-1", "117-hr-1319"]);
  expect(searchBills(bills, "hr 1", 2).length).toBe(2);
});

test("bills by title words", () => {
  expect(searchBills(bills, "genius")[0]?.id).toBe("119-s-1582");
  expect(searchBills(bills, "inflation red").map((b) => b.id)).toEqual(["117-hr-5376"]);
  expect(searchBills(bills, "stablecoin")[0]?.id).toBe("119-s-1582");
  expect(searchBills(bills, "zzzz")).toEqual([]);
});

test("no query lists the library, newest first", () => {
  expect(searchBills(bills, "").map((b) => b.id)).toEqual([
    "119-s-1582",
    "119-hr-1",
    "118-hr-1",
    "117-hr-5376",
    "117-hr-1319",
  ]);
});

test("a bill the library lacks is named, not invented", () => {
  expect(missingBill(bills, "S.9999")).toEqual({ id: "119-s-9999", display: "S.9999" });
  expect(missingBill(bills, "S.1582")).toBeNull();
  expect(missingBill(bills, "stablecoin")).toBeNull();
});

const m = buildModel(Bundle.parse(genius));

test("sections by number, with or without the sign, and by heading words", () => {
  expect(searchSections(m, "§19")[0]?.s.num).toBe("19");
  expect(searchSections(m, "section 19")[0]?.s.num).toBe("19");
  expect(searchSections(m, "disclosure")[0]?.s.heading).toMatch(/disclosure/i);
  expect(searchSections(m, "")).toEqual([]);
  expect(searchSections(m, "§99999")).toEqual([]);
});

test("a section's slug finds it again", () => {
  for (const v of m.sections) {
    const found = m.sectionBySlug(m.sectionSlug(v));
    expect(found?.s.id).toBe(v.s.id);
  }
});
