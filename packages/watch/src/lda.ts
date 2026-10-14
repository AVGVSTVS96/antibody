import { type BillId, billRef } from "@antibody/core";
import { get } from "./http.ts";

const API = "https://lda.gov/api/v1/filings/";
const token = process.env.LDA_API_KEY;
const spacingMs = token ? 520 : 4100;
let last = 0;

const SPELLINGS: Record<string, string[]> = {
  hr: ["H.R. #", "H.R.#", "HR #", "HR#", "H. R. #"],
  s: ["S. #", "S.#"],
  hjres: ["H.J.Res. #", "H.J. Res. #", "H.J.Res.#", "HJRES #"],
  sjres: ["S.J.Res. #", "S.J. Res. #", "S.J.Res.#", "SJRES #"],
  hconres: ["H.Con.Res. #", "H. Con. Res. #", "HCONRES #"],
  sconres: ["S.Con.Res. #", "S. Con. Res. #", "SCONRES #"],
};

/** The congress's two calendar years: the 119th sat in 2025 and 2026. */
export const congressYears = (congress: number) => [1789 + 2 * (congress - 1), 1790 + 2 * (congress - 1)];

/**
 * The lda.gov full-text query for filings that name the bill by number. The short title is left out on purpose: titles
 * repeat across chambers and congresses (H.R.9772's "Foreign Funding Transparency Act" brought in 40 filings about
 * other bills, none naming H.R.9772), while a number inside the congress's two years names this bill.
 */
export function lobbyingQuery(id: BillId): string {
  const { type, number } = billRef(id);
  return (SPELLINGS[type] ?? []).map((s) => `"${s.replace("#", String(number))}"`).join(" OR ");
}

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
