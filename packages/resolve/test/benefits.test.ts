import { expect, test } from "bun:test";
import type { Row } from "@antibody/core";
import { findNames, lobbiedBenefits, splitSections } from "../src/benefits.ts";
import type { Company } from "../src/edgar.ts";
import { norm } from "../src/normalize.ts";

const XML = `<bill><legis-body>
<section id="a"><enum>1.</enum><header>Short title</header><text>This Act may be cited as the Example Act.</text></section>
<section id="b"><enum>2.</enum><header>Payments</header><text>The Secretary shall pay Tesla, Inc. and the General Motors Company
amounts under the American National Standards Institute rules. A visa holder may apply.</text>
<quoted-block><section id="q"><enum>9.</enum><text>Amtrak and General Motors shall report.</text></section></quoted-block>
</section>
<section id="c"><enum>3.</enum><text>general motors in lower case is not a name.</text></section>
</legis-body></bill>`;

const companies: Company[] = [
  { cik: "1318605", name: "Tesla, Inc.", tickers: ["TSLA"], exchange: "Nasdaq" },
  { cik: "1467858", name: "General Motors Co", tickers: ["GM"], exchange: "NYSE" },
  { cik: "1403161", name: "VISA INC.", tickers: ["V"], exchange: "NYSE" },
  { cik: "1039828", name: "American National Group Inc.", tickers: ["ANG"], exchange: "NYSE" },
];

test("bill sections own the quoted text they insert", () => {
  const s = splitSections(XML);
  expect(s.map((x) => x.num)).toEqual(["1", "2", "3"]);
  expect(s[1]!.text).toContain("Amtrak and General Motors shall report");
});

test("names are found only as capitalized whole names, one-word names only with a legal suffix", () => {
  const hits = findNames(splitSections(XML), companies, norm);
  expect(hits.map((h) => `${h.num}:${h.matched}`)).toEqual(["2:Tesla", "2:General Motors", "2:General Motors"]);
});

test("lobbied: one whole-bill row per company plus one per cited section; topic-only refs don't count", () => {
  const bill = "119-s-1582" as const;
  const ref = (
    id: string,
    filing: string,
    how: Row<"lda_bill_refs">["how"],
    nums: string[] = [],
  ): Row<"lda_bill_refs"> => ({
    id,
    filing_id: filing,
    bill_id: bill,
    section_nums: nums,
    issue_code: "FIN",
    quote: "S. 1582, GENIUS Act",
    how,
    match: "high",
    phase: "bill",
    source_url: `https://lda.gov/filings/public/filing/${filing}/print/`,
    source_locator: null,
  });
  const filing = (id: string, client: string) => ({ id, client_key: client }) as Row<"lda_filings">;
  const res: Row<"resolutions"> = {
    id: "client:coinbase",
    src: "client:coinbase",
    company_id: "1679788",
    method: "llm_subsidiary",
    rule: "subsidiary-parent",
    confidence: 0.95,
    rests_on: ["lda_clients/coinbase", "companies/1679788"],
    evidence: { name: "COINBASE, INC." },
  };
  const section = { id: "119-s-1582@s394-is:sec:4", bill_id: bill, num: "4", in_final: true } as Row<"sections">;
  const rows = lobbiedBenefits(
    bill,
    [ref("r1", "f1", "number", ["4"]), ref("r2", "f2", "name"), ref("r3", "f3", "topic")],
    new Map([
      ["f1", filing("f1", "coinbase")],
      ["f2", filing("f2", "coinbase")],
      ["f3", filing("f3", "coinbase")],
    ]),
    new Map([[res.id, res]]),
    [section],
  );
  expect(rows.map((r) => [r.id, r.evidence.refs])).toEqual([
    ["119-s-1582:lobbied:1679788", 2],
    ["119-s-1582:lobbied:1679788:119-s-1582@s394-is:sec:4", 1],
  ]);
  expect(rows[0]!.rests_on).toEqual(["resolutions/client:coinbase", "lda_bill_refs/r1", "lda_bill_refs/r2"]);
  expect(rows[0]!.confidence).toBe(0.95);
});
