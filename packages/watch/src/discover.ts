import { CURRENT_CONGRESS, parseBillId } from "@antibody/core";
import type { BillId } from "@antibody/core";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { parsePackage } from "./billstatus.ts";
import type { CboEstimate } from "./billstatus.ts";
import { getText } from "./http.ts";

export const WATCHED_TYPES = ["hr", "s", "hjres", "sjres", "hconres", "sconres", "hres", "sres"] as const;

export interface SourceReport {
  name: string;
  url: string;
  ok: boolean;
  items: number;
  error: string | null;
}

export interface Discovery {
  bills: Map<BillId, string | null>;
  published: Map<string, string>;
  cbo: Map<BillId, CboEstimate[]>;
  sources: SourceReport[];
}

const xml = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  isArray: (n) => n === "url" || n === "item",
});

const text = z.string().nullish().catch(null);

const Sitemap = z.object({
  urlset: z
    .object({ url: z.array(z.object({ loc: text, lastmod: text })) })
    .nullish()
    .catch(null),
});

const Rss = z.object({
  rss: z
    .object({
      channel: z
        .object({
          item: z.array(z.object({ guid: text, pubDate: text, title: text, link: text, description: text })),
        })
        .nullish()
        .catch(null),
    })
    .nullish()
    .catch(null),
});

const rssItems = (body: string) => Rss.parse(xml.parse(body)).rss?.channel?.item ?? [];

const isoDay = (d: string | null | undefined) =>
  d === null || d === undefined || d === "" ? null : new Date(d).toISOString().slice(0, 10);

const watched = (id: BillId) => WATCHED_TYPES.some((t) => t === id.split("-")[1]);

export async function discover(since: string, signal?: AbortSignal): Promise<Discovery> {
  const out: Discovery = { bills: new Map(), published: new Map(), cbo: new Map(), sources: [] };

  const note = (id: BillId, lastmod: string | null) => {
    if (watched(id) && ((lastmod !== null && lastmod !== "") || !out.bills.has(id))) {
      out.bills.set(id, lastmod ?? out.bills.get(id) ?? null);
    }
  };

  const run = async (name: string, url: string, read: (body: string) => number) => {
    try {
      const items = read(await getText(url, { signal }));
      out.sources.push({ name, url, ok: true, items, error: null });
    } catch (error) {
      out.sources.push({
        name,
        url,
        ok: false,
        items: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  await Promise.all([
    ...WATCHED_TYPES.map(async (t) => {
      await run(
        `GovInfo BILLSTATUS sitemap (${t})`,
        `https://www.govinfo.gov/sitemap/bulkdata/BILLSTATUS/${CURRENT_CONGRESS}${t}/sitemap.xml`,
        (body) => {
          let n = 0;

          for (const u of Sitemap.parse(xml.parse(body)).urlset?.url ?? []) {
            const lastmod = u.lastmod ?? "";

            const name = (u.loc ?? "").split("/").pop();

            if (name === undefined || name === "" || lastmod.slice(0, 10) < since) {
              continue;
            }

            note(parseBillId(name), lastmod);
            n++;
          }

          return n;
        },
      );
    }),
    ...["bills", "bills-enr"].map(async (feed) => {
      await run(`GovInfo new bill text (${feed}.xml)`, `https://www.govinfo.gov/rss/${feed}.xml`, (body) => {
        let n = 0;

        for (const item of rssItems(body)) {
          const pkg = item.guid ?? "";
          const parsed = parsePackage(pkg);
          const date = isoDay(item.pubDate);

          if (!parsed || date === null) {
            continue;
          }

          out.published.set(pkg, date);

          if (date < since) {
            continue;
          }

          note(parsed.bill, null);
          n++;
        }

        return n;
      });
    }),
    run("CBO publications feed", "https://www.cbo.gov/publications/all/rss.xml", (body) => {
      let n = 0;

      for (const item of rssItems(body)) {
        const publishedOn = isoDay(item.pubDate);

        if (publishedOn === null || publishedOn < since) {
          continue;
        }

        const title = item.title ?? "";

        const ref =
          /\b(H\.\s?R\.|S\.|H\.\s?J\.\s?Res\.|S\.\s?J\.\s?Res\.|H\.\s?Con\.\s?Res\.|S\.\s?Con\.\s?Res\.)\s?(\d+)/u.exec(
            title,
          );

        if (!ref) {
          continue;
        }

        const [, type = "", number = ""] = ref;
        const id = parseBillId(`${type} ${number}`);
        note(id, null);
        const url = item.link ?? "";

        if (url !== "") {
          out.cbo.set(id, [
            ...(out.cbo.get(id) ?? []),
            {
              url,
              title,
              description:
                item.description === null || item.description === undefined || item.description === ""
                  ? null
                  : item.description,
              publishedOn,
            },
          ]);
        }

        n++;
      }

      return n;
    }),
  ]);

  return out;
}
