import { expect, test } from "bun:test";
import { billDisplay, billstatusUrl, congressGovUrl, parseBillId } from "../src/ids.ts";

test.each([
  ["119-s-1582", "119-s-1582"],
  ["S.1582", "119-s-1582"],
  ["s1582", "119-s-1582"],
  ["H.R. 1", "119-hr-1"],
  ["H.R.5376 (117th)", "117-hr-5376"],
  ["HJRES 12", "119-hjres-12"],
  ["H.Con.Res. 14", "119-hconres-14"],
  ["BILLS-119hr1enr", "119-hr-1"],
  ["BILLSTATUS-119s1582.xml", "119-s-1582"],
  ["https://www.congress.gov/bill/117th-congress/house-bill/5376/text", "117-hr-5376"],
])("parseBillId(%p)", (input, expected) => {
  expect(parseBillId(input)).toBe(expected as never);
});

test("rejects junk", () => {
  expect(() => parseBillId("GENIUS Act")).toThrow();
});

test("urls and display", () => {
  expect(billDisplay("119-hr-1")).toBe("H.R.1");
  expect(congressGovUrl("119-s-1582")).toBe("https://www.congress.gov/bill/119th-congress/senate-bill/1582");
  expect(billstatusUrl("119-s-1582")).toBe("https://www.govinfo.gov/bulkdata/BILLSTATUS/119/s/BILLSTATUS-119s1582.xml");
});
