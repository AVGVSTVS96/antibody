import { expect, test } from "bun:test";
import { type Row, TABLES } from "@antibody/core";
import { billNames, parseBillStatus } from "../src/billstatus.ts";
import { clientKey, markSuperseded, phaseOf } from "../src/rows.ts";
import { spendRows } from "../src/spend.ts";

test("client keys merge one company's many lda.gov client ids", () => {
  expect(clientKey("VISA U.S.A. INC.", 1)).toBe("visa");
  expect(clientKey("Coinbase, Inc.", 2)).toBe("coinbase");
  expect(clientKey("Akin OBO Crypto Council for Innovation", 3)).toBe("crypto-council-for-innovation");
  expect(clientKey("THE GROUP, INC.", 9)).toBe("lda-9");
});

test("phases split at the quarter of enactment", () => {
  expect(phaseOf("2025-04-01", "2025-06-30", "2025-07-18")).toBe("bill");
  expect(phaseOf("2025-07-01", "2025-09-30", "2025-07-18")).toBe("enactment-quarter");
  expect(phaseOf("2025-10-01", "2025-12-31", "2025-07-18")).toBe("law");
  expect(phaseOf("2030-01-01", "2030-03-31", null)).toBe("bill");
});

const filing = (id: string, over: Partial<Row<"lda_filings">>): Row<"lda_filings"> => ({
  id,
  url: `https://lda.gov/filings/public/filing/${id}/print/`,
  api_url: `https://lda.gov/api/v1/filings/${id}/`,
  form: "LD-2",
  type: "Q1",
  year: 2025,
  period: "first_quarter",
  period_start: "2025-01-01",
  period_end: "2025-03-31",
  posted_at: "2025-04-20T10:00:00-04:00",
  registrant_id: "r1",
  registrant_name: "Firm",
  client_key: "visa",
  lda_client_id: "c1",
  client_name: "VISA",
  client_description: null,
  amount_usd: 100_000,
  amount_kind: "income",
  issue_lines: 4,
  superseded: false,
  source_url: `https://lda.gov/filings/public/filing/${id}/print/`,
  source_locator: "Income line",
  ...over,
});

test("a later amendment for the same registrant, client and period supersedes the original", () => {
  const rows = markSuperseded([
    filing("a", {}),
    filing("b", { type: "1A", posted_at: "2025-05-01T10:00:00-04:00" }),
    filing("c", { form: "LD-1", type: "RR" }),
  ]);
  expect(rows.map((r) => r.superseded)).toEqual([true, false, false]);
});

test("spend counts in-house expenses over outside income per client-quarter, and the share is an inference", () => {
  const filings = new Map(
    [
      filing("inhouse", { registrant_id: "visa", amount_kind: "expenses", amount_usd: 1_000_000, issue_lines: 10 }),
      filing("outside", { amount_usd: 200_000 }),
      filing("q2", { period: "second_quarter", period_start: "2025-04-01", period_end: "2025-06-30" }),
      filing("old", { superseded: true }),
      filing("other", { client_key: "tether", lda_client_id: "c9", amount_usd: null, amount_kind: null }),
    ].map((f) => [f.id, f]),
  );
  const line = (id: string, filing_id: string) => ({
    id,
    filing_id,
    phase: "bill" as const,
    quote: "S.1582",
    section_nums: [],
  });
  const rows = spendRows("119-s-1582", filings, [
    line("inhouse#0#119-s-1582", "inhouse"),
    line("inhouse#1#119-s-1582", "inhouse"),
    line("outside#0#119-s-1582", "outside"),
    line("q2#0#119-s-1582", "q2"),
    line("old#0#119-s-1582", "old"),
    line("other#0#119-s-1582", "other"),
  ]);
  for (const r of rows) expect(TABLES.lda_spend.schema.safeParse(r).success).toBe(true);
  const visa = rows.find((r) => r.client_key === "visa")!;
  expect(visa.reports).toBe(3);
  expect(visa.quarters).toBe(2);
  expect(visa.total_usd).toBe(1_100_000);
  expect(visa.share_usd).toBe(225_000);
  expect(visa.total_rests_on).toEqual(["lda_filings/inhouse", "lda_filings/q2"]);
  const tether = rows.find((r) => r.client_key === "tether")!;
  expect(tether.total_usd).toBeNull();
  const whole = rows.find((r) => r.client_key === null)!;
  expect(whole.total_usd).toBe(1_100_000);
  expect(whole.reports).toBe(4);
  expect(whole.rests_on).toEqual(["lda_spend/119-s-1582:visa#share", "lda_spend/119-s-1582:tether#total"]);
});

test("BILLSTATUS: whole-bill and portion titles, law and enactment date", () => {
  const xml = `<billStatus><bill><introducedDate>2021-09-27</introducedDate>
    <titles>
      <item><titleType>Display Title</titleType><title>Inflation Reduction Act of 2022</title></item>
      <item><titleType>Official Title as Introduced</titleType><title>To provide for reconciliation pursuant to title II of S. Con. Res. 14.</title></item>
      <item><titleType>Short Title(s) as Reported to House for portions of this bill</titleType><title>Build Back Better Act</title></item>
    </titles>
    <laws><item><type>Public Law</type><number>117-169</number></item></laws>
    <actions><item><actionDate>2022-08-16</actionDate><text>Became Public Law No: 117-169.</text></item></actions>
  </bill></billStatus>`;
  const s = parseBillStatus("117-hr-5376", xml);
  expect(s.introduced).toBe("2021-09-27");
  expect(s.laws).toEqual(["117-169"]);
  expect(s.enactedOn).toBe("2022-08-16");
  expect(billNames(s)).toEqual({ whole: ["Inflation Reduction Act of 2022"], portions: ["Build Back Better Act"] });
});
