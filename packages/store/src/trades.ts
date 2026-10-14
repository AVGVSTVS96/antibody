import { norm, parseAsset, tokens } from "@antibody/resolve";

/**
 * Tickers are reused: a trade is joined to a company by ticker, so a different company that once held the same
 * ticker lands on the wrong one. Each pair here was checked by hand against the disclosure's own asset name.
 */
const TICKER_REUSED = [
  { ticker: "COR", asset: /^coresite\b/i },
  { ticker: "CNR", asset: /^cornerstone\b/i },
];

export const reusedTicker = (ticker: string | null, asset: string) =>
  TICKER_REUSED.some((r) => r.ticker === ticker?.toUpperCase() && r.asset.test(asset));

/**
 * Whether the asset name on the disclosure shares a word with the company's SEC name. A false only means the names
 * differ (a rename, a spelling, or a different company): the trade is kept and marked, not hidden.
 */
export function nameMatches(asset: string, company: string): boolean {
  const a = new Set(tokens(norm(parseAsset(asset.replaceAll("&#x27;", "'")).name)));
  return !a.size || tokens(norm(company)).some((t) => a.has(t));
}
