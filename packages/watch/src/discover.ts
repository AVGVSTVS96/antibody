import { type BillId, CURRENT_CONGRESS, parseBillId } from "@antibody/core";
import { XMLParser } from "fast-xml-parser";
import { type CboEstimate, parsePackage } from "./billstatus.ts";
import { getText } from "./http.ts";

/** Types the watcher follows. Simple resolutions (H.Res., S.Res.) never become law and are left out. */
export const WATCHED_TYPES = ["hr", "s", "hjres", "sjres", "hconres", "sconres"] as const;

export interface SourceReport {
  name: string;
  url: string;
  ok: boolean;
  items: number;
  error: string | null;
}

export interface Discovery {
  /** Bill → its BILLSTATUS lastmod (or null when only a feed named it). */
  bills: Map<BillId, string | null>;
  /** GovInfo text package (BILLS-119hr1eh) → the date GovInfo published it. */
  published: Map<string, string>;
  /** CBO estimates from CBO's own feed, which can list one before BILLSTATUS does. */
  cbo: Map<BillId, CboEstimate[]>;
  sources: SourceReport[];
}

const xml = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  isArray: (n) => n === "url" || n === "item",
});
const isoDay = (d: string) => new Date(d).toISOString().slice(0, 10);
const watched = (id: BillId) => (WATCHED_TYPES as readonly string[]).includes(id.split("-")[1]!);

/** Bills with BILLSTATUS updates, new text versions or new CBO estimates on or after `since`. */
export async function discover(since: string, signal?: AbortSignal): Promise<Discovery> {
  const out: Discovery = { bills: new Map(), published: new Map(), cbo: new Map(), sources: [] };
  const note = (id: BillId, lastmod: string | null) => {
    if (watched(id) && (lastmod || !out.bills.has(id))) out.bills.set(id, lastmod ?? out.bills.get(id) ?? null);
  };

  const run = async (name: string, url: string, read: (body: string) => number) => {
    try {
      const items = read(await getText(url, { signal }));
      out.sources.push({ name, url, ok: true, items, error: null });
    } catch (e) {
      out.sources.push({ name, url, ok: false, items: 0, error: String((e as Error).message ?? e) });
    }
  };

  await Promise.all([
    ...WATCHED_TYPES.map((t) =>
      run(
        `GovInfo BILLSTATUS sitemap (${t})`,
        `https://www.govinfo.gov/sitemap/bulkdata/BILLSTATUS/${CURRENT_CONGRESS}${t}/sitemap.xml`,
        (body) => {
          let n = 0;
          for (const u of xml.parse(body).urlset?.url ?? []) {
            const lastmod = String(u.lastmod ?? "");
            const name = String(u.loc ?? "")
              .split("/")
              .pop();
            if (!name || lastmod.slice(0, 10) < since) continue;
            note(parseBillId(name), lastmod);
            n++;
          }
          return n;
        },
      ),
    ),
    ...["bills", "bills-enr"].map((feed) =>
      run(`GovInfo new bill text (${feed}.xml)`, `https://www.govinfo.gov/rss/${feed}.xml`, (body) => {
        let n = 0;
        for (const item of xml.parse(body).rss?.channel?.item ?? []) {
          const pkg = String(item.guid ?? "");
          const parsed = parsePackage(pkg);
          const date = item.pubDate ? isoDay(String(item.pubDate)) : null;
          if (!parsed || !date) continue;
          out.published.set(pkg, date);
          if (date < since) continue;
          note(parsed.bill, null);
          n++;
        }
        return n;
      }),
    ),
    run("CBO publications feed", "https://www.cbo.gov/publications/all/rss.xml", (body) => {
      let n = 0;
      for (const item of xml.parse(body).rss?.channel?.item ?? []) {
        const publishedOn = item.pubDate ? isoDay(String(item.pubDate)) : null;
        if (!publishedOn || publishedOn < since) continue;
        const title = String(item.title ?? "");
        const ref = title.match(
          /\b(H\.\s?R\.|S\.|H\.\s?J\.\s?Res\.|S\.\s?J\.\s?Res\.|H\.\s?Con\.\s?Res\.|S\.\s?Con\.\s?Res\.)\s?(\d+)/,
        );
        if (!ref) continue;
        const id = parseBillId(`${ref[1]} ${ref[2]}`);
        note(id, null);
        const url = String(item.link ?? "");
        if (url)
          out.cbo.set(id, [
            ...(out.cbo.get(id) ?? []),
            { url, title, description: item.description ? String(item.description) : null, publishedOn },
          ]);
        n++;
      }
      return n;
    }),
  ]);
  return out;
}
