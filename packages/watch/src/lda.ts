import { billRef, lobbyingQuery } from "@antibody/core";
import type { BillId, BillType } from "@antibody/core";
import { z } from "zod";
import { get } from "./http.ts";

const API = "https://lda.gov/api/v1/filings/";
const token = process.env.LDA_API_KEY;
const hasToken = token !== undefined && token !== "";
const spacingMs = hasToken ? 520 : 4100;

export const MAX_PAGES = 8;
let last = 0;

export const congressYears = (congress: number): [number, number] => [
  1789 + 2 * (congress - 1),
  1790 + 2 * (congress - 1),
];

export { lobbyingQuery } from "@antibody/core";

export const lobbyingUrl = (query: string, year: number, page = 1) =>
  `${API}?${new URLSearchParams({ filing_specific_lobbying_issues: query, filing_year: String(year), page_size: "25", page: String(page) }).toString()}`;

const TYPE_RE = {
  hr: String.raw`H\.?\s?R`,
  s: "S",
  hjres: String.raw`H\.?\s?J\.?\s?Res`,
  sjres: String.raw`S\.?\s?J\.?\s?Res`,
  hconres: String.raw`H\.?\s?Con\.?\s?Res`,
  sconres: String.raw`S\.?\s?Con\.?\s?Res`,
  hres: String.raw`H\.?\s?Res`,
  sres: String.raw`S\.?\s?Res`,
} as const satisfies Record<BillType, string>;

export function citesBill(text: string, id: BillId): boolean {
  const { type, number, congress } = billRef(id);

  const re = new RegExp(
    String.raw`(?<![A-Za-z.'’])${TYPE_RE[type]}[.,]?\s?${number}(?!\d|-\d|,\d)`,
    type === "s" ? "gu" : "giu",
  );

  for (const m of text.matchAll(re)) {
    const near = text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 60);
    const named = /\b(1\d\d)(?:th|st|nd|rd)\s+Congress/iu.exec(near);

    if (!named || Number(named[1]) === congress) {
      return true;
    }
  }

  return false;
}

export interface FilingCheck {
  confirmed: number;
  checked: number;
  searched: number;
  urls: string[];
}

const Page = z.object({
  count: z.number(),
  results: z.array(
    z.object({
      filing_uuid: z.string(),
      lobbying_activities: z.array(z.object({ description: z.string().nullish() })).nullish(),
    }),
  ),
});

export async function lobbyingFilings(id: BillId, signal?: AbortSignal): Promise<FilingCheck> {
  const query = lobbyingQuery(id);
  const confirmed = new Set<string>();
  const seen = new Set<string>();
  const urls: string[] = [];
  let searched = 0;

  for (const year of congressYears(billRef(id).congress)) {
    if (year > new Date().getFullYear()) {
      continue;
    }

    for (let page = 1; page <= MAX_PAGES; page++) {
      const wait = last + spacingMs - Date.now();

      if (wait > 0) {
        await Bun.sleep(wait);
      }

      last = Date.now();
      const url = lobbyingUrl(query, year, page);

      const res = await get(url, {
        accept: "application/json",
        signal,
        headers: hasToken ? { Authorization: `Token ${token}` } : {},
      });

      const body = Page.parse(await res.json());

      if (page === 1) {
        searched += body.count;
        urls.push(lobbyingUrl(query, year));
      }

      for (const f of body.results) {
        seen.add(f.filing_uuid);

        if ((f.lobbying_activities ?? []).some((a) => citesBill(a.description ?? "", id))) {
          confirmed.add(f.filing_uuid);
        }
      }

      if (page * 25 >= body.count) {
        break;
      }
    }
  }

  return { confirmed: confirmed.size, checked: seen.size, searched, urls };
}
