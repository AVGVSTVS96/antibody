import { mkdir, rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { billRef, billstatusUrl } from "@antibody/core";
import type { BillId } from "@antibody/core";
import { paths } from "@antibody/core/node";
import { z } from "zod";
import type { Listing } from "./estimates.ts";

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

const ArchivedCopy = z.object({ url: z.string(), archiveUrl: z.string().nullable() });

async function get(url: string, signal?: AbortSignal, timeoutMs = 60_000): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const wait = nextAt - Date.now();

    if (wait > 0) {
      await Bun.sleep(wait);
    }

    nextAt = Date.now() + SPACING_MS;

    let res: Response | null;

    try {
      res = await fetch(url, {
        headers: { "user-agent": UA },
        signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]),
      });
    } catch (error) {
      if (signal?.aborted === true) {
        throw error;
      }

      res = null;
    }

    if (res && res.status !== 429 && res.status < 500) {
      return res;
    }

    if (attempt === 4) {
      throw new Error(`${url}: ${res?.status ?? "no response"}`);
    }

    await Bun.sleep(5000 * 2 ** attempt);
  }
}

async function cached(file: string, url: string, { refresh, signal }: Opts): Promise<string> {
  const f = Bun.file(file);

  if (!refresh && (await f.exists())) {
    return await f.text();
  }

  const res = await get(url, signal);

  if (!res.ok) {
    throw new Error(`${url}: ${res.status}`);
  }

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

export async function billstatus(bill: BillId, opts: Opts): Promise<string> {
  const url = billstatusUrl(bill);

  return await cached(join(paths.raw("cbo"), "billstatus", basename(url)), url, opts);
}

async function captures(url: string, signal?: AbortSignal): Promise<string[]> {
  const q = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&filter=statuscode:200&fl=timestamp&limit=-${CAPTURES}`;
  const res = await get(q, signal);

  if (!res.ok) {
    return [];
  }

  return (await res.text())
    .split("\n")
    .map((t) => t.trim())
    .filter((t) => /^\d{14}$/u.test(t))
    .toReversed();
}

async function saveNow(url: string, signal?: AbortSignal) {
  await get(`https://web.archive.org/save/${url}`, signal, 180_000).catch(() => null);
}

const CAPTURES = 4;
const text = (b: Uint8Array) => new TextDecoder().decode(b.slice(0, 8192));

const VALID: [RegExp, (b: Uint8Array) => boolean][] = [
  [/\.pdf$/iu, (b) => text(b).startsWith("%PDF-")],
  [/\.xlsx?$/iu, (b) => (b[0] === 0x50 && b[1] === 0x4b) || (b[0] === 0xd0 && b[1] === 0xcf)],
  [
    /\.html$/iu,
    (b) => /<html/iu.test(text(b)) && !/captcha-delivery|enable JS and disable any ad blocker/iu.test(text(b)),
  ],
];

export async function archived(url: string, file: string, opts: Opts & { near?: string }): Promise<Fetched | null> {
  const meta = Bun.file(`${file}.json`);

  if (!opts.refresh && (await meta.exists()) && (await Bun.file(file).exists())) {
    return { ...ArchivedCopy.parse(await meta.json()), file };
  }

  const valid = VALID.find(([re]) => re.test(file))?.[1] ?? (() => true);
  const tried = new Set<string>();

  const attempt = async (stamp: string): Promise<Fetched | null> => {
    let res: Response;

    try {
      res = await get(`https://web.archive.org/web/${stamp}id_/${url}`, opts.signal, 180_000);
    } catch (error) {
      if (opts.signal?.aborted === true) {
        throw error;
      }

      return null;
    }

    const ts = /\/web\/(\d{14})id_\//u.exec(res.url)?.[1] ?? stamp;

    if (tried.has(ts)) {
      return null;
    }

    tried.add(ts);

    if (!res.ok) {
      return null;
    }

    const bytes = new Uint8Array(await res.arrayBuffer());

    if (!valid(bytes)) {
      return null;
    }

    await save(file, bytes);
    const fetched = { url, archiveUrl: `https://web.archive.org/web/${ts}/${url}` };
    await save(`${file}.json`, JSON.stringify(fetched));

    return { ...fetched, file };
  };

  for (const stamp of [opts.near ?? "", "2099"].filter((x) => x !== "")) {
    const got = await attempt(stamp);

    if (got) {
      return got;
    }
  }

  for (const round of [0, 1]) {
    if (round) {
      await saveNow(url, opts.signal);
    }

    for (const ts of await captures(url, opts.signal)) {
      const got = tried.has(ts) ? null : await attempt(ts);

      if (got) {
        return got;
      }
    }
  }

  return null;
}

const FILE_LINK =
  /(?:https?:\/\/www\.cbo\.gov)?\/system\/files\/(?<month>\d{4}-\d{2})\/(?<name>[^"'?#\s<>]+?\.(?:pdf|xlsx|xls))/giu;

export async function publicationFiles(listing: Listing, bill: BillId, opts: Opts): Promise<Fetched[]> {
  const dir = paths.raw("cbo");
  const near = listing.pubDate.slice(0, 10).replaceAll("-", "");
  const page = await archived(listing.url, join(dir, "pub", `${listing.pubId}.html`), { ...opts, near });
  let links: string[] = [];

  if (page) {
    const html = await Bun.file(page.file).text();
    links = [...html.matchAll(FILE_LINK)].map(({ groups }) => fileUrl(groups?.month ?? "", groups?.name ?? ""));
  }

  if (!links.length) {
    links = await monthFiles(listing, bill, opts);
  }

  const out: Fetched[] = [];

  for (const url of new Set(links)) {
    const got = await archived(url, localFile(url), { ...opts, near });

    if (got) {
      out.push(got);
    }
  }

  return out;
}

export function localFile(url: string): string {
  const groups = /files\/(?<month>\d{4}-\d{2})\/(?<name>.+)$/u.exec(url)?.groups;
  const month = groups?.month;
  const name = groups?.name;

  if (month === undefined || name === undefined) {
    throw new Error(`not a cbo.gov file URL: ${url}`);
  }

  return join(paths.raw("cbo"), "files", month, decodeURIComponent(name));
}

function fileUrl(month: string, name: string) {
  return `https://www.cbo.gov/system/files/${month}/${name}`;
}

async function monthFiles(listing: Listing, bill: BillId, { signal }: Opts): Promise<string[]> {
  const { type, number } = billRef(bill);
  const own = new RegExp(`(^|[^a-z])${type}${number}([^0-9]|$)`, "iu");
  const month = listing.pubDate.slice(0, 7);
  const q = `https://web.archive.org/cdx/search/cdx?url=cbo.gov/system/files/${month}/&matchType=prefix&filter=statuscode:200&fl=original&collapse=urlkey`;
  const res = await get(q, signal);

  if (!res.ok) {
    return [];
  }

  return (await res.text()).split("\n").flatMap((original) => {
    const name = original.trim().replace(/\?.*$/su, "").split("/").at(-1) ?? "";
    const ours = own.test(name.replaceAll(/[-_\s]/gu, "")) || name.startsWith(`${listing.pubId}-`);

    return /\.(pdf|xlsx?)$/iu.test(name) && ours ? [fileUrl(month, name)] : [];
  });
}
