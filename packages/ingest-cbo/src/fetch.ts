import { mkdir, rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { type BillId, billRef, billstatusUrl } from "@antibody/core";
import { paths } from "@antibody/core/node";
import type { Listing } from "./estimates.ts";

/**
 * cbo.gov answers every script with a DataDome 403, so files come from the Internet Archive's copy
 * (`web.archive.org/web/<ts>id_/<url>` returns the original bytes). Claims cite the cbo.gov URL and keep the
 * archive URL as the copy we read. When nothing is archived yet, Save Page Now is asked for a capture.
 */

const UA = "antibody/1.0 (+https://github.com/AVGVSTVS96/antibody)";
const SPACING_MS = 1000;
let nextAt = 0;

interface Opts {
  refresh: boolean;
  signal?: AbortSignal;
}

export interface Fetched {
  url: string;
  archiveUrl: string | null;
  file: string;
}

async function get(url: string, signal?: AbortSignal, timeoutMs = 60_000): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const wait = nextAt - Date.now();
    if (wait > 0) await Bun.sleep(wait);
    nextAt = Date.now() + SPACING_MS;
    const res = await fetch(url, {
      headers: { "user-agent": UA },
      signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]),
    }).catch((e) => {
      if (signal?.aborted) throw e;
      return null;
    });
    if (res && res.status !== 429 && res.status < 500) return res;
    if (attempt === 4) throw new Error(`${url}: ${res?.status ?? "no response"}`);
    await Bun.sleep(5000 * 2 ** attempt);
  }
}

async function cached(file: string, url: string, { refresh, signal }: Opts): Promise<string> {
  const f = Bun.file(file);
  if (!refresh && (await f.exists())) return f.text();
  const res = await get(url, signal);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const text = await res.text();
  await save(file, text);
  return text;
}

async function save(file: string, data: string | Uint8Array) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await Bun.write(tmp, data);
  await rename(tmp, file);
}

export function billstatus(bill: BillId, opts: Opts): Promise<string> {
  const url = billstatusUrl(bill);
  return cached(join(paths.raw("cbo"), "billstatus", basename(url)), url, opts);
}

/** Newest first. A capture can be DataDome's challenge page served with a 200, so callers try a few. */
async function captures(url: string, signal?: AbortSignal): Promise<string[]> {
  const q = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&filter=statuscode:200&fl=timestamp&limit=-${CAPTURES}`;
  const res = await get(q, signal);
  if (!res.ok) return [];
  return (await res.text())
    .split("\n")
    .map((t) => t.trim())
    .filter((t) => /^\d{14}$/.test(t))
    .reverse();
}

async function saveNow(url: string, signal?: AbortSignal) {
  await get(`https://web.archive.org/save/${url}`, signal, 180_000).catch(() => null);
}

const CAPTURES = 4;
const text = (b: Uint8Array) => new TextDecoder().decode(b.slice(0, 8192));
const VALID: [RegExp, (b: Uint8Array) => boolean][] = [
  [/\.pdf$/i, (b) => text(b).startsWith("%PDF-")],
  [/\.xlsx?$/i, (b) => (b[0] === 0x50 && b[1] === 0x4b) || (b[0] === 0xd0 && b[1] === 0xcf)],
  [
    /\.html$/i,
    (b) => /<html/i.test(text(b)) && !/captcha-delivery|enable JS and disable any ad blocker/i.test(text(b)),
  ],
];

/**
 * A real archived copy of a cbo.gov URL, saved under data/cbo/ with a sidecar naming the archive URL.
 * Replay redirects to the capture nearest a timestamp, so the capture nearest `near` (the publication date) and
 * the newest are tried first; the CDX listing is slow (often 40s), so it is the fallback, then Save Page Now.
 */
export async function archived(url: string, file: string, opts: Opts & { near?: string }): Promise<Fetched | null> {
  const meta = Bun.file(`${file}.json`);
  if (!opts.refresh && (await meta.exists()) && (await Bun.file(file).exists()))
    return { ...((await meta.json()) as Omit<Fetched, "file">), file };
  const valid = VALID.find(([re]) => re.test(file))?.[1] ?? (() => true);
  const tried = new Set<string>();
  const attempt = async (stamp: string): Promise<Fetched | null> => {
    // The Wayback Machine sometimes answers a replay with a status of its own (900) after every retry; that capture
    // is unreadable, not the whole estimate.
    const res = await get(`https://web.archive.org/web/${stamp}id_/${url}`, opts.signal, 180_000).catch((e) => {
      if (opts.signal?.aborted) throw e;
      return null;
    });
    if (!res) return null;
    const ts = res.url.match(/\/web\/(\d{14})id_\//)?.[1] ?? stamp;
    if (tried.has(ts)) return null;
    tried.add(ts);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!valid(bytes)) return null;
    await save(file, bytes);
    const fetched = { url, archiveUrl: `https://web.archive.org/web/${ts}/${url}` };
    await save(`${file}.json`, JSON.stringify(fetched));
    return { ...fetched, file };
  };
  for (const stamp of [opts.near, "2099"].filter((x): x is string => !!x)) {
    const got = await attempt(stamp);
    if (got) return got;
  }
  for (const round of [0, 1]) {
    if (round) await saveNow(url, opts.signal);
    for (const ts of await captures(url, opts.signal)) {
      const got = tried.has(ts) ? null : await attempt(ts);
      if (got) return got;
    }
  }
  return null;
}

const FILE_LINK = /(?:https?:\/\/www\.cbo\.gov)?\/system\/files\/(\d{4}-\d{2})\/([^"'?#\s<>]+?\.(?:pdf|xlsx|xls))/gi;

/** The PDF and Excel files of one CBO publication, read from its archived page (or the month's archived files). */
export async function publicationFiles(listing: Listing, bill: BillId, opts: Opts): Promise<Fetched[]> {
  const dir = paths.raw("cbo");
  const near = listing.pubDate.slice(0, 10).replaceAll("-", "");
  const page = await archived(listing.url, join(dir, "pub", `${listing.pubId}.html`), { ...opts, near });
  let links: string[] = [];
  if (page) {
    const html = await Bun.file(page.file).text();
    links = [...html.matchAll(FILE_LINK)].map(([, month, name]) => fileUrl(month!, name!));
  }
  if (!links.length) links = await monthFiles(listing, bill, opts);
  const out: Fetched[] = [];
  for (const url of [...new Set(links)]) {
    const got = await archived(url, localFile(url), { ...opts, near });
    if (got) out.push(got);
  }
  return out;
}

/** Where a cbo.gov file lives on disk: data/cbo/files/<yyyy-mm>/<name>, the month keeping same-named files apart. */
export function localFile(url: string): string {
  const [, month, name] = url.match(/files\/(\d{4}-\d{2})\/(.+)$/)!;
  return join(paths.raw("cbo"), "files", month!, decodeURIComponent(name!));
}

function fileUrl(month: string, name: string) {
  return `https://www.cbo.gov/system/files/${month}/${name}`;
}

/** Fallback when the publication page itself was never archived: files in its month whose name carries the bill. */
async function monthFiles(listing: Listing, bill: BillId, { signal }: Opts): Promise<string[]> {
  const { type, number } = billRef(bill);
  const own = new RegExp(`(^|[^a-z])${type}${number}([^0-9]|$)`, "i");
  const month = listing.pubDate.slice(0, 7);
  const q = `https://web.archive.org/cdx/search/cdx?url=cbo.gov/system/files/${month}/&matchType=prefix&filter=statuscode:200&fl=original&collapse=urlkey`;
  const res = await get(q, signal);
  if (!res.ok) return [];
  return (await res.text()).split("\n").flatMap((original) => {
    const name = original.trim().split("?")[0]!.split("/").at(-1) ?? "";
    const ours = own.test(name.replace(/[-_\s]/g, "")) || name.startsWith(`${listing.pubId}-`);
    return /\.(pdf|xlsx?)$/i.test(name) && ours ? [fileUrl(month, name)] : [];
  });
}
