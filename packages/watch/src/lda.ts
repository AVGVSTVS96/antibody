import { type BillId, billRef, lobbyingQuery } from "@antibody/core";
import { get } from "./http.ts";

const API = "https://lda.gov/api/v1/filings/";
const token = process.env.LDA_API_KEY;
const spacingMs = token ? 520 : 4100;
let last = 0;

/** The congress's two calendar years: the 119th sat in 2025 and 2026. */
export const congressYears = (congress: number) => [1789 + 2 * (congress - 1), 1790 + 2 * (congress - 1)];

export { lobbyingQuery };

export const lobbyingUrl = (query: string, year: number) =>
  `${API}?${new URLSearchParams({ filing_specific_lobbying_issues: query, filing_year: String(year), page_size: "1" })}`;

/**
 * LD-2/LD-1 filings in the bill's congress whose lobbying issues name it. An upper bound: the x-ray's lobbying
 * stage disambiguates each mention and replaces this count when it has run.
 */
export async function lobbyingFilings(id: BillId, signal?: AbortSignal) {
  const query = lobbyingQuery(id);
  let count = 0;
  const urls: string[] = [];
  for (const year of congressYears(billRef(id).congress)) {
    if (year > new Date().getFullYear()) continue;
    const wait = last + spacingMs - Date.now();
    if (wait > 0) await Bun.sleep(wait);
    last = Date.now();
    const url = lobbyingUrl(query, year);
    const res = await get(url, {
      accept: "application/json",
      signal,
      headers: token ? { Authorization: `Token ${token}` } : {},
    });
    count += ((await res.json()) as { count: number }).count;
    urls.push(url);
  }
  return { count, urls };
}
