import { exists, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { paths } from "@antibody/core/node";
import { download, pool } from "./http.ts";

const EFD = "https://efdsearch.senate.gov";
/** eFD sits behind a terms checkbox + Django CSRF; a cookie jar and a browser User-Agent get through. */
const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export interface SenateReport {
  first: string;
  last: string;
  office: string;
  kind: "ptr" | "paper";
  id: string;
  title: string;
  filed: string;
  url: string;
}

export interface SenateRow {
  n: number;
  date: string;
  owner: string;
  ticker: string | null;
  asset: string;
  assetDetail: string | null;
  assetType: string;
  type: string;
  amount: string;
  comment: string | null;
}

export const senateRoot = () => join(paths.raw("trades"), "senate");
export const pagePath = (id: string) => join(senateRoot(), "pages", `${id}.html`);
export const imageDir = (id: string) => join(senateRoot(), "images", id);

class Efd {
  jar = new Map<string, string>();

  async get(path: string, init: RequestInit = {}) {
    const res = await fetch(EFD + path, {
      ...init,
      redirect: "manual",
      headers: {
        "User-Agent": BROWSER_UA,
        Referer: `${EFD}/search/`,
        Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "),
        ...init.headers,
      },
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair = ""] = c.split(";");
      const i = pair.indexOf("=");
      this.jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return res;
  }

  async open() {
    const home = await (await this.get("/search/home/")).text();
    const token = home.match(/name="csrfmiddlewaretoken" value="([^"]+)"/)?.[1];
    if (!token) throw new Error("eFD: no CSRF token on /search/home/");
    const agreed = await this.get("/search/home/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ prohibition_agreement: "1", csrfmiddlewaretoken: token }),
    });
    if (agreed.status !== 302) throw new Error(`eFD terms POST returned ${agreed.status}`);
    return this;
  }

  async list(since: string): Promise<SenateReport[]> {
    const out: SenateReport[] = [];
    const csrf = this.jar.get("csrftoken")!;
    for (let start = 0; ; start += 100) {
      const res = await this.get("/search/report/data/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "X-CSRFToken": csrf },
        body: new URLSearchParams({
          start: String(start),
          length: "100",
          report_types: "[11]",
          filer_types: "[]",
          submitted_start_date: `${since} 00:00:00`,
          submitted_end_date: "",
          candidate_state: "",
          senator_state: "",
          office_id: "",
          first_name: "",
          last_name: "",
          csrfmiddlewaretoken: csrf,
        }),
      });
      const page = (await res.json()) as { recordsTotal: number; data: string[][] };
      for (const [first = "", last = "", office = "", link = "", filed = ""] of page.data) {
        const m = link.match(/href="(\/search\/view\/(ptr|paper)\/([^/]+)\/)"[^>]*>([^<]+)</);
        if (!m) continue;
        const [, path = "", kind, id = "", title = ""] = m;
        out.push({ first, last, office, kind: kind as SenateReport["kind"], id, title, filed, url: EFD + path });
      }
      if (start + 100 >= page.recordsTotal) return out;
      await Bun.sleep(250);
    }
  }
}

/** Lists every Senate PTR since `since` (MM/DD/YYYY) and fetches the report pages not on disk, 250 ms apart. */
export async function fetchSenate(since: string, log: (m: string) => void) {
  await mkdir(join(senateRoot(), "pages"), { recursive: true });
  const efd = await new Efd().open();
  const reports = await efd.list(since);
  await Bun.write(join(senateRoot(), "reports.json"), JSON.stringify(reports, null, 1));
  let fetched = 0;
  const blocked: string[] = [];
  for (const r of reports) {
    if (await exists(pagePath(r.id))) continue;
    const res = await efd.get(new URL(r.url).pathname);
    const html = await res.text();
    if (res.status !== 200 || !html.includes(r.kind === "ptr" ? "<table" : "filingImage")) {
      blocked.push(r.url);
      if (blocked.length > 5) break;
      continue;
    }
    await Bun.write(pagePath(r.id), html);
    if (++fetched % 100 === 0) log(`  Senate pages ${fetched}`);
    await Bun.sleep(250);
  }
  log(`Senate: ${reports.length} reports, ${fetched} pages fetched, ${blocked.length} blocked`);
  return { reports, blocked };
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

/** Rows of an electronic Senate PTR: the page's one transactions table, nine columns. */
export function parseSenatePtr(html: string): SenateRow[] {
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1];
  if (!body) return [];
  const rows: SenateRow[] = [];
  for (const tr of body.match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
    const td = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
      decode((m[1] ?? "").replace(/<div class="text-muted">([\s\S]*?)<\/div>/g, " | $1")),
    );
    if (td.length < 9) continue;
    const [
      n = "",
      date = "",
      owner = "",
      ticker = "",
      asset = "",
      assetType = "",
      type = "",
      amount = "",
      comment = "",
    ] = td;
    const [assetName = "", ...detail] = asset.split(" | ");
    rows.push({
      n: Number(n),
      date,
      owner,
      ticker: ticker === "--" ? null : ticker.replace(/\s.*$/, ""),
      asset: assetName.trim(),
      assetDetail: detail.join(" | ").trim() || null,
      assetType,
      type,
      amount,
      comment: comment === "--" ? null : comment,
    });
  }
  return rows;
}

/** The scanned page images of a paper report, in order. */
export function paperImages(html: string): string[] {
  return [...html.matchAll(/<img\b[^>]*class="filingImage"[^>]*?\ssrc="([^"]+)"/g)].map((m) => m[1]!);
}

export async function fetchPaperImages(reports: SenateReport[]) {
  await pool(
    reports.filter((r) => r.kind === "paper"),
    2,
    async (r) => {
      const html = await Bun.file(pagePath(r.id))
        .text()
        .catch(() => "");
      const dir = imageDir(r.id);
      await mkdir(dir, { recursive: true });
      for (const [i, url] of paperImages(html).entries()) {
        const file = join(dir, `${i + 1}.gif`);
        if (!(await exists(file))) await download(url, file, { "User-Agent": BROWSER_UA });
      }
    },
  );
}
