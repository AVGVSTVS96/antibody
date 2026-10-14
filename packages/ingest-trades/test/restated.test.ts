import { describe, expect, test } from "bun:test";
import type { Row } from "@antibody/core";
import { collapseRestated } from "../src/restated.ts";

const trade = (id: string, document_id: string, amount: string, over: Partial<Row<"trades">> = {}) =>
  ({
    id,
    document_id,
    bioguide: "X000001",
    filer_name: "A Member",
    chamber: "House",
    owner: "self",
    asset: "Acme Corp (ACME) [ST]",
    asset_type: "ST",
    ticker: "ACME",
    type: "sale",
    traded_on: "2024-03-01",
    notified_on: null,
    amount,
    amount_min: null,
    amount_max: null,
    page: 1,
    read_by: "text",
    confidence: 1,
    needs_second_read: false,
    raw: {},
    source_url: "https://example.gov/x.pdf",
    source_locator: null,
    ...over,
  }) as Row<"trades">;

const docs = new Map([
  ["h-1", { filedOn: "2024-03-10", amended: false }],
  ["h-2", { filedOn: "2024-03-20", amended: false }],
  ["h-3", { filedOn: "2024-04-02", amended: true }],
]);

describe("collapseRestated", () => {
  test("an exact re-filing keeps the first filing and says where it was repeated", () => {
    const out = collapseRestated([trade("a", "h-1", "$1,001 - $15,000"), trade("b", "h-2", "$1,001 - $15,000")], docs);
    expect(out.map((t) => t.id)).toEqual(["a"]);
    expect(out[0]?.raw).toEqual({ also_filed_in: ["h-2"] });
  });

  test("an amended filing replaces the earlier rows even when the amount was corrected", () => {
    const out = collapseRestated([trade("a", "h-1", "$1,001 - $15,000"), trade("c", "h-3", "$15,001 - $50,000")], docs);
    expect(out.map((t) => t.id)).toEqual(["c"]);
    expect(out[0]?.raw).toEqual({ restates: ["a"] });
  });

  test("a different, unamended filing of the same asset and day stays beside the first", () => {
    const out = collapseRestated([trade("a", "h-1", "$1,001 - $15,000"), trade("b", "h-2", "$15,001 - $50,000")], docs);
    expect(out.map((t) => t.id)).toEqual(["a", "b"]);
  });

  test("several identical trades inside one filing all stay", () => {
    const out = collapseRestated([trade("a", "h-1", "$1,001 - $15,000"), trade("b", "h-1", "$1,001 - $15,000")], docs);
    expect(out).toHaveLength(2);
  });

  test("another owner's trade is a different group", () => {
    const out = collapseRestated(
      [trade("a", "h-1", "$1,001 - $15,000"), trade("b", "h-2", "$1,001 - $15,000", { owner: "spouse" })],
      docs,
    );
    expect(out).toHaveLength(2);
  });
});
