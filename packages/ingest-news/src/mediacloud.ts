import { ROOT } from "@antibody/core/node";

const API = "https://search.mediacloud.org/api/";

/** Media Cloud allows an API token 2 search calls a minute; directory calls are not limited. */
const SEARCH_GAP_MS = 31_000;
let nextSearchAt = 0;

export interface Story {
  id: string;
  url: string;
  title: string;
  publish_date: string | null;
  media_name: string;
  media_url: string;
}

export async function mediacloudKey(): Promise<string | null> {
  if (process.env.MEDIACLOUD_API_KEY) return process.env.MEDIACLOUD_API_KEY;
  const env = Bun.file(`${ROOT}/.env`);
  const fromMain = Bun.file(`${process.env.HOME}/Developer/antibody/.env`);
  for (const f of [env, fromMain]) {
    if (!(await f.exists())) continue;
    const m = (await f.text()).match(/^MEDIACLOUD_API_KEY=(.+)$/m);
    if (m) return m[1]!.trim();
  }
  return null;
}

async function call<T>(
  path: string,
  params: Record<string, string>,
  search: boolean,
  signal?: AbortSignal,
): Promise<T> {
  const key = await mediacloudKey();
  if (!key) throw new Error("no MEDIACLOUD_API_KEY in the environment or .env");
  const url = `${API}${path}?${new URLSearchParams(params)}`;
  for (let attempt = 0; ; attempt++) {
    if (search) {
      const wait = nextSearchAt - Date.now();
      if (wait > 0) await Bun.sleep(wait);
      nextSearchAt = Date.now() + SEARCH_GAP_MS;
    }
    const res = await fetch(url, { headers: { authorization: `Token ${key}` }, signal });
    if (res.ok) return (await res.json()) as T;
    const body = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      nextSearchAt = Date.now() + SEARCH_GAP_MS * (attempt + 2);
      continue;
    }
    throw new Error(`Media Cloud ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }
}

export interface Window {
  start: string;
  end: string;
}

const searchParams = (query: string, sources: number[], w: Window) => ({
  q: query,
  ss: sources.join(","),
  start: w.start,
  end: w.end,
});

export async function storyCount(query: string, sources: number[], w: Window, signal?: AbortSignal) {
  const r = await call<{ count: { relevant: number } }>(
    "search/total-count",
    searchParams(query, sources, w),
    true,
    signal,
  );
  return r.count.relevant;
}

export async function countsBySource(query: string, sources: number[], w: Window, signal?: AbortSignal) {
  const r = await call<{ sources: { source: string; count: number }[] }>(
    "search/sources",
    searchParams(query, sources, w),
    true,
    signal,
  );
  return Object.fromEntries(r.sources.map((s) => [s.source, s.count]));
}

/** Every story matching the query in the given sources (1,000 per page, one rate-limited call per page). */
export async function stories(query: string, sources: number[], w: Window, signal?: AbortSignal): Promise<Story[]> {
  const out: Story[] = [];
  let token: string | null = null;
  do {
    const params: Record<string, string> = searchParams(query, sources, w);
    if (token) params.pagination_token = token;
    const page: { stories: Story[]; pagination_token: string | null } = await call(
      "search/story-list",
      params,
      true,
      signal,
    );
    out.push(...page.stories);
    token = page.pagination_token;
  } while (token);
  return out;
}

export interface Source {
  id: number;
  name: string;
  stories_per_week: number | null;
  stories_total: number | null;
  media_type: string | null;
}

export async function sourceByDomain(domain: string): Promise<Source | null> {
  const r = await call<{ results: Source[] }>(
    "sources/sources/",
    { name: domain, platform: "online_news", limit: "10" },
    false,
  );
  return r.results.find((s) => s.name === domain) ?? null;
}

export async function collectionSources(collectionId: number): Promise<Source[]> {
  const out: Source[] = [];
  let offset = 0;
  for (;;) {
    const r = await call<{ results: Source[]; next: string | null }>(
      "sources/sources/",
      { collection_id: String(collectionId), limit: "1000", offset: String(offset) },
      false,
    );
    out.push(...r.results);
    if (!r.next) return out;
    offset += r.results.length;
  }
}
