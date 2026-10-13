import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const BASE = "https://lda.gov/api/v1";
const CACHE = new URL("../../data/lobbying/cache/", import.meta.url).pathname;
const token = process.env.LDA_API_KEY;
const spacingMs = token ? 520 : 4100;
let last = 0;

async function throttle() {
  const wait = last + spacingMs - Date.now();
  if (wait > 0) await Bun.sleep(wait);
  last = Date.now();
}

export async function get(url: string): Promise<any> {
  await mkdir(CACHE, { recursive: true });
  const file = Bun.file(CACHE + createHash("sha1").update(url).digest("hex") + ".json");
  if (await file.exists()) return file.json();
  for (let attempt = 0; ; attempt++) {
    await throttle();
    const res = await fetch(url, { headers: token ? { Authorization: `Token ${token}` } : {} });
    if (res.status === 429) {
      const retry = Number(res.headers.get("retry-after") ?? 30);
      console.error(`429, waiting ${retry}s`);
      await Bun.sleep(retry * 1000);
      continue;
    }
    if (!res.ok) {
      if (attempt < 3) { await Bun.sleep(5000); continue; }
      throw new Error(`${res.status} ${url}`);
    }
    const body = await res.json();
    await Bun.write(file, JSON.stringify(body));
    return body;
  }
}

export function filingsUrl(params: Record<string, string | number>, page = 1) {
  const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), page_size: "25", page: String(page) });
  return `${BASE}/filings/?${q}`;
}

export async function count(params: Record<string, string | number>) {
  return (await get(filingsUrl(params))).count as number;
}

export async function* allFilings(params: Record<string, string | number>, concurrency = 8) {
  const first = await get(filingsUrl(params));
  yield* first.results;
  const pages = Math.ceil(first.count / 25);
  for (let start = 2; start <= pages; start += concurrency) {
    const batch = Array.from({ length: Math.min(concurrency, pages - start + 1) }, (_, i) => get(filingsUrl(params, start + i)));
    for (const d of await Promise.all(batch)) yield* d.results;
  }
}
