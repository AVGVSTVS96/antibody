import { expect, test } from "bun:test";
import type { Row } from "@antibody/core";
import type { Company } from "../src/edgar.ts";
import { ratio, tokenSet, tokenSort } from "../src/fuzzy.ts";
import { CompanyIndex, type Mention, resolveMention } from "../src/match.ts";
import { employerMentions, pacMentions, tradeMentions } from "../src/mentions.ts";
import { assetName, norm, tickerInAsset } from "../src/normalize.ts";

const co = (cik: number, name: string, ...tickers: string[]): Company => ({
  cik: String(cik),
  name,
  tickers,
  exchange: "NYSE",
});
const index = new CompanyIndex([
  co(1403161, "VISA INC.", "V"),
  co(1679788, "Coinbase Global, Inc.", "COIN"),
  co(1555280, "Edgewell Personal Care Co", "EPC"),
  co(107263, "WILLIAMS COMPANIES, INC.", "WMB"),
  co(63754, "MCCORMICK & CO INC", "MKC"),
  co(1818874, "Compass, Inc.", "COMP"),
  co(797468, "OCCIDENTAL PETROLEUM CORP /DE/", "OXY"),
  co(1652044, "Alphabet Inc.", "GOOGL", "GOOG"),
  co(1067983, "BERKSHIRE HATHAWAY INC", "BRK-B", "BRK-A"),
  co(1001, "Duke Energy CORP", "DUK"),
  co(1002, "Duke Realty Corp", "DRE"),
  co(1003, "DUKE ENERGY INC /NC/", "DUKN"),
]);
const m = (source: Mention["source"], name: string, ticker: string | null = null): Mention => ({
  src: `${source}:x`,
  source,
  name,
  ticker,
  context: null,
  restsOn: [`x/${name}`],
});

test("the scorers agree with rapidfuzz", () => {
  expect(ratio("this is a test", "this is a test!")).toBeCloseTo(96.55, 1);
  expect(tokenSort("fuzzy wuzzy was a bear", "wuzzy fuzzy was a bear")).toBe(100);
  expect(tokenSet("fuzzy was a bear", "fuzzy fuzzy was a bear")).toBe(100);
  expect(ratio("", "")).toBe(100);
});

test("normalization keeps the real client and drops legal and PAC words", () => {
  expect(norm("MAYER BROWN LLP OBO CIRCLE INTERNET FINANCIAL, LLC")).toBe("CIRCLE INTERNET FINANCIAL");
  expect(norm("OCCIDENTAL PETROLEUM CORPORATION POLITICAL ACTION COMMITTEE")).toBe("OCCIDENTAL PETROLEUM");
  expect(norm("OCCIDENTAL PETROLEUM CORP /DE/")).toBe("OCCIDENTAL PETROLEUM");
  expect(norm("NEWMONT CORPORATION (F/K/A NEWMONT GOLDCORP CORPORATION)")).toBe("NEWMONT");
  expect(assetName("Alphabet Inc. - Class A Common Stock (GOOGL) [ST]")).toBe("Alphabet Inc.");
  expect(tickerInAsset("Berkshire Hathaway Inc. New (BRK.B) [ST]")).toBe("BRK.B");
});

test("a PTR ticker resolves when its company name agrees, share classes included", () => {
  const r = resolveMention(m("trade", "Berkshire Hathaway Inc. New (BRK.B) [ST]"), index);
  expect(r.kind === "match" && r.match.cik).toBe("1067983");
  expect(r.kind === "match" && r.match.method).toBe("ticker");
});

test("a recycled or wrong ticker goes to review instead of matching", () => {
  const r = resolveMention(m("trade", "Visa Inc. Class A (DUK) [ST]", "DUK"), index);
  expect(r.kind).toBe("queue");
});

test("a parenthesized acronym in a lobbying name is not a ticker (EPC ≠ Edgewell)", () => {
  const r = resolveMention(m("client", "ELECTRONIC PAYMENTS COALITION (EPC)"), index);
  expect(r.kind === "match" && r.match.cik === "1555280").toBe(false);
});

test("leadership PACs are never resolved (WILLIAMS ≠ Williams Companies)", () => {
  const pacs = pacMentions([
    {
      id: "C1",
      name: "PATRIOTS IN ACTION",
      connected_org: "WILLIAMS",
      type: "Q",
      designation: "D",
      source_url: "https://www.fec.gov/data/committee/C1/",
      source_locator: null,
    },
    {
      id: "C2",
      name: "OXY PAC",
      connected_org: "OCCIDENTAL PETROLEUM CORPORATION",
      type: "Q",
      designation: "B",
      source_url: "https://www.fec.gov/data/committee/C2/",
      source_locator: null,
    },
    {
      id: "C3",
      name: "SMITH FOR CONGRESS",
      connected_org: null,
      type: "H",
      designation: "P",
      source_url: "https://www.fec.gov/data/committee/C3/",
      source_locator: null,
    },
  ]);
  expect(pacs.map((p) => p.src)).toEqual(["pac:C2"]);
  const r = resolveMention(pacs[0]!, index);
  expect(r.kind === "match" && r.match.method).toBe("name_exact");
});

test("a one-word name goes to review even when it matches exactly (Compass Group ADR ≠ Compass, Inc.)", () => {
  expect(resolveMention(m("trade", "Compass Group plc ADR (CMPGY)"), index).kind).toBe("queue");
  expect(resolveMention(m("client", "COMPASS"), index).kind).toBe("queue");
});

test("a name shared by two SEC companies is never auto-picked", () => {
  const r = resolveMention(m("pac", "DUKE ENERGY CORPORATION"), index);
  expect(r.kind === "queue" && r.queued.candidates.slice(0, 2).map((c) => c.cik)).toEqual(["1001", "1003"]);
});

test("associations skip review when no SEC name is close", () => {
  const r = resolveMention(m("client", "NATIONAL ASSOCIATION OF CONVENIENCE STORES"), index);
  expect(r.kind).toBe("none");
});

test("only stock and option trades are resolved", () => {
  const base = {
    document_id: "d",
    bioguide: null,
    filer_name: "x",
    chamber: "House" as const,
    owner: "self" as const,
    type: "purchase" as const,
    traded_on: null,
    notified_on: null,
    amount: "$1,001 - $15,000",
    amount_min: 1001,
    amount_max: 15000,
    page: 1,
    read_by: "text" as const,
    confidence: 1,
    needs_second_read: false,
    raw: {},
    source_url: "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2025/1.pdf",
    source_locator: null,
  };
  const ms = tradeMentions([
    { ...base, id: "1", asset: "Visa Inc. (V) [ST]", asset_type: "ST", ticker: "V" },
    { ...base, id: "2", asset: "DELL INTL LLC/EMC CORP", asset_type: "Corporate Bond", ticker: null },
  ]);
  expect(ms.map((x) => x.src)).toEqual(["trade:1"]);
});

test("donor employers merge across members; small ones skip review and keep only deterministic matches", () => {
  const row = (id: string, employer: string, key: string, usd: number) =>
    ({ id, employer, employer_key: key, amount_usd: usd }) as Row<"employer_contributions">;
  const [big, small] = employerMentions([
    row("a", "Occidental Petroleum Corp.", "OCCIDENTAL PETROLEUM", 20_000),
    row("b", "OCCIDENTAL PETROLEUM CORPORATION", "OCCIDENTAL PETROLEUM", 9_000),
    row("c", "Compass", "COMPASS", 2_000),
  ]);
  expect(big!.name).toBe("Occidental Petroleum Corp.");
  expect(big!.reviewable).toBe(true);
  expect(resolveMention(big!, index).kind).toBe("match");
  expect(resolveMention(small!, index).kind).toBe("none");
});
