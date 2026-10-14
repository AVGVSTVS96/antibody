import { describe, expect, test } from "bun:test";
import { parseIndex } from "../src/house.ts";
import { amountRange, isoDate, owner, tradeType } from "../src/normalize.ts";
import { settle } from "../src/rows.ts";
import { paperImages, parseSenatePtr } from "../src/senate.ts";
import type { PageResult } from "../src/vision.ts";

describe("normalize", () => {
  test("owner codes from both chambers map to one vocabulary", () => {
    expect(["", "SP", "JT", "DC", "Self", "Spouse", "Joint", "Child"].map(owner)).toEqual([
      "self",
      "spouse",
      "joint",
      "dependent",
      "self",
      "spouse",
      "joint",
      "dependent",
    ]);
    expect(["S", "(J)", "(DC)"].map(owner)).toEqual(["spouse", "joint", "dependent"]);
    expect(owner("Trust")).toBeNull();
  });

  test("transaction types", () => {
    expect(
      ["P", "S", "S (partial)", "E", "Purchase", "Sale (Full)", "Sale (Partial)", "Exchange", "sale_partial"].map(
        tradeType,
      ),
    ).toEqual([
      "purchase",
      "sale",
      "sale_partial",
      "exchange",
      "purchase",
      "sale",
      "sale_partial",
      "exchange",
      "sale_partial",
    ]);
    expect(tradeType("")).toBeNull();
  });

  test("dates parse only when they are real calendar dates", () => {
    expect(isoDate("09/11/2025")).toBe("2025-09-11");
    expect(isoDate("10/20/23")).toBe("2023-10-20");
    expect(isoDate("10-01-2020")).toBe("2020-10-01");
    expect(isoDate("09/1_/26")).toBeNull();
    expect(isoDate("02/30/2025")).toBeNull();
  });

  test("amount ranges, open-ended and exact amounts", () => {
    expect(amountRange("$15,001 - $50,000")).toEqual({ min: 15001, max: 50000 });
    expect(amountRange("Over $50,000,000")).toEqual({ min: 50000001, max: null });
    expect(amountRange("Spouse/DC Over $1,000,000")).toEqual({ min: 1000001, max: null });
    expect(amountRange("$360.00")).toEqual({ min: 360, max: 360 });
    expect(amountRange("$.25")).toEqual({ min: 0.25, max: 0.25 });
    expect(amountRange("$15,001 \u00ad $50,000")).toEqual({ min: 15001, max: 50000 });
    expect(amountRange("")).toEqual({ min: null, max: null });
  });
});

test("House index keeps only PTRs and marks paper DocIDs as scanned", () => {
  const text = [
    "Prefix\tLast\tFirst\tSuffix\tFilingType\tStateDst\tYear\tFilingDate\tDocID",
    "Hon.\tMoore\tTim\t\tP\tNC14\t2025\t9/29/2025\t20032256",
    "Hon.\tKhanna\tRo\t\tP\tCA17\t2025\t10/2/2025\t8220906",
    "\tAbel\tWilliam\t\tC\tTX31\t2024\t5/12/2024\t10060658",
  ].join("\r\n");
  const rows = parseIndex(`﻿${text}`);
  expect(rows.map((r) => [r.docId, r.scanned, r.url])).toEqual([
    ["20032256", false, "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2025/20032256.pdf"],
    ["8220906", true, "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2025/8220906.pdf"],
  ]);
});

describe("Senate eFD", () => {
  const html = `<table><tbody>
    <tr><td>2</td><td> 09/15/2022 </td><td>Spouse</td><td> -- </td>
      <td> BCS Contingent Autocall COF <div class="text-muted"><em>Rate/Coupon:</em> 10%<br> <em>Matures:</em> 10/25/2024</div></td>
      <td>Corporate Bond</td><td>Sale (Full)</td><td>$15,001 - $50,000</td><td>--</td></tr>
    <tr><td>3</td><td>05/10/2023</td><td>Joint</td><td><a href="https://finance.yahoo.com/quote/WFC">WFC</a></td>
      <td>Wells Fargo &amp; Company Common Stock</td><td>Stock</td><td>Sale (Partial)</td><td>$1,001 - $15,000</td><td>--</td></tr>
  </tbody></table>`;

  test("electronic PTR rows keep asset details apart from the name", () => {
    expect(parseSenatePtr(html)).toEqual([
      {
        n: 2,
        date: "09/15/2022",
        owner: "Spouse",
        ticker: null,
        asset: "BCS Contingent Autocall COF",
        assetDetail: "Rate/Coupon: 10% Matures: 10/25/2024",
        assetType: "Corporate Bond",
        type: "Sale (Full)",
        amount: "$15,001 - $50,000",
        comment: null,
      },
      {
        n: 3,
        date: "05/10/2023",
        owner: "Joint",
        ticker: "WFC",
        asset: "Wells Fargo & Company Common Stock",
        assetDetail: null,
        assetType: "Stock",
        type: "Sale (Partial)",
        amount: "$1,001 - $15,000",
        comment: null,
      },
    ]);
  });

  test("paper reports list their page images in order", () => {
    const page = `<img style="margin-top: 110px;" class="filingImage"
      src="https://efd-media-public.senate.gov/media/2026/2/000/000/000000521.gif" alt="filing document" />
      <img class="filingImage" src="https://efd-media-public.senate.gov/media/2026/2/000/000/000000522.gif" />`;
    expect(paperImages(page)).toEqual([
      "https://efd-media-public.senate.gov/media/2026/2/000/000/000000521.gif",
      "https://efd-media-public.senate.gov/media/2026/2/000/000/000000522.gif",
    ]);
  });
});

describe("vision rows", () => {
  const row = {
    owner: "DC",
    asset: "VERIZON COMMUNICATIONS INC HYBRID 02/15/2059",
    ticker: null,
    type: "purchase",
    date: "09/1_/26",
    notified: "10/01/26",
    amount: "$1,001 - $15,000",
    uncertain: ["date" as const],
    note: null,
  };
  const page = (cells: { row: number; field: "date"; value: string; readable: boolean }[]): PageResult => ({
    doc: "h-8220906",
    page: 2,
    model: "claude-opus-5-5",
    read: { page_kind: "form", filer_name: null, rows: [row] },
    recheck: { cells },
    calls: [],
  });

  test("a readable recheck fills an unreadable cell, and the row stays flagged", () => {
    const s = settle(row, 0, page([{ row: 0, field: "date", value: "09/15/26", readable: true }]));
    expect(s.values.date).toBe("09/15/26");
    expect(s.flagged).toBe(true);
    expect(s.confidence).toBe(0.5);
  });

  test("an unreadable recheck keeps the first reading with its blanks", () => {
    const s = settle(row, 0, page([{ row: 0, field: "date", value: "09/1_/26", readable: false }]));
    expect(s.values.date).toBe("09/1_/26");
    expect(isoDate(s.values.date)).toBeNull();
    expect(s.confidence).toBe(0.5);
  });

  test("rows read with certainty are not flagged", () => {
    const sure = { ...row, date: "09/15/26", uncertain: [] };
    const s = settle(sure, 0, { ...page([]), recheck: null });
    expect(s).toMatchObject({ flagged: false, confidence: 0.9 });
  });
});
