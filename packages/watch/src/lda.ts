import { type BillId, billRef, lobbyingQuery } from "@antibody/core";
import { get } from "./http.ts";

const API = "https://lda.gov/api/v1/filings/";
const token = process.env.LDA_API_KEY;
const spacingMs = token ? 520 : 4100;
/** 25 filings a page; the cap keeps a daily run short, and a bill past it reports "N of M checked". */
export const MAX_PAGES = 8;
let last = 0;

/** The congress's two calendar years: the 119th sat in 2025 and 2026. */
export const congressYears = (congress: number) => [1789 + 2 * (congress - 1), 1790 + 2 * (congress - 1)];

export { lobbyingQuery };

export const lobbyingUrl = (query: string, year: number, page = 1) =>
  `${API}?${new URLSearchParams({ filing_specific_lobbying_issues: query, filing_year: String(year), page_size: "25", page: String(page) })}`;

const TYPE_RE: Record<string, string> = {
  hr: String.raw`H\.?\s?R`,
  s: "S",
  hjres: String.raw`H\.?\s?J\.?\s?Res`,
  sjres: String.raw`S\.?\s?J\.?\s?Res`,
  hconres: String.raw`H\.?\s?Con\.?\s?Res`,
  sconres: String.raw`S\.?\s?Con\.?\s?Res`,
};

/**
 * Whether an issue line cites this exact bill: the type and number as a whole token ("H.R. 1" is not "H.R. 1319"
 * or "H.R. 1-A"), and no other Congress named beside it ("H.R. 1 (118th Congress)" is another bill).
 */
export function citesBill(text: string, id: BillId): boolean {
  const { type, number, congress } = billRef(id);
  const re = new RegExp(
    String.raw`(?<![A-Za-z.'’])${TYPE_RE[type]}[.,]?\s?${number}(?!\d|-\d|,\d)`,
    type === "s" ? "g" : "gi",
  );
  for (const m of text.matchAll(re)) {
    const near = text.slice(Math.max(0, m.index! - 40), m.index! + m[0].length + 60);
    const named = near.match(/\b(1\d\d)(?:th|st|nd|rd)\s+Congress/i);
    if (!named || Number(named[1]) === congress) return true;
  }
  return false;
}

export interface FilingCheck {
  /** Filings whose issue lines cite the bill, confirmed one by one. */
  confirmed: number;
  /** Filings read. */
  checked: number;
  /** What lda.gov's search says match (it counts every issue line that hit, so it runs high). */
  searched: number;
  urls: string[];
}

interface Page {
  count: number;
  results: { filing_uuid: string; lobbying_activities?: { description: string | null }[] }[];
}

/**
 * LD-2/LD-1 filings in the bill's congress that cite the bill by number. lda.gov's search finds candidates; each
 * is read and kept only when `citesBill` agrees, so the count is of checked filings, never of search hits.
 */
export async function lobbyingFilings(id: BillId, signal?: AbortSignal): Promise<FilingCheck> {
  const query = lobbyingQuery(id);
  const confirmed = new Set<string>();
  const seen = new Set<string>();
  const urls: string[] = [];
  let searched = 0;
  for (const year of congressYears(billRef(id).congress)) {
    if (year > new Date().getFullYear()) continue;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const wait = last + spacingMs - Date.now();
      if (wait > 0) await Bun.sleep(wait);
      last = Date.now();
      const url = lobbyingUrl(query, year, page);
      const res = await get(url, {
        accept: "application/json",
        signal,
        headers: token ? { Authorization: `Token ${token}` } : {},
      });
      const body = (await res.json()) as Page;
      if (page === 1) {
        searched += body.count;
        urls.push(lobbyingUrl(query, year));
      }
      for (const f of body.results) {
        seen.add(f.filing_uuid);
        if ((f.lobbying_activities ?? []).some((a) => a.description && citesBill(a.description, id)))
          confirmed.add(f.filing_uuid);
      }
      if (page * 25 >= body.count) break;
    }
  }
  return { confirmed: confirmed.size, checked: seen.size, searched, urls };
}
