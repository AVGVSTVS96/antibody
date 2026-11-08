import { ROOT } from "@antibody/core/node";
import { z } from "zod";

const API = "https://search.mediacloud.org/api/";

const SEARCH_GAP_MS = 31_000;
let nextSearchAt = 0;

export interface Story {
  id: string;
  url: string;
  title: string;
  publish_date?: string | null | undefined;
  media_name: string;
  media_url: string;
}

export const StoryJson: z.ZodType<Story> = z.looseObject({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  publish_date: z.string().nullish(),
  media_name: z.string(),
  media_url: z.string(),
});

export async function mediacloudKey(): Promise<string | null> {
  const fromEnv = process.env.MEDIACLOUD_API_KEY ?? "";

  if (fromEnv !== "") {
    return fromEnv;
  }

  const env = Bun.file(`${ROOT}/.env`);
  const fromMain = Bun.file(`${process.env.HOME ?? "undefined"}/Developer/antibody/.env`);

  for (const f of [env, fromMain]) {
    if (!(await f.exists())) {
      continue;
    }

    const key = /^MEDIACLOUD_API_KEY=(.+)$/mu.exec(await f.text())?.[1];

    if (key !== undefined) {
      return key.trim();
    }
  }

  return null;
}

async function call<T extends z.ZodType>(
  path: string,
  params: Record<string, string>,
  search: boolean,
  schema: T,
  signal?: AbortSignal,
): Promise<z.infer<T>> {
  const key = await mediacloudKey();

  if (key === null || key === "") {
    throw new Error("no MEDIACLOUD_API_KEY in the environment or .env");
  }

  const url = `${API}${path}?${new URLSearchParams(params).toString()}`;

  for (let attempt = 0; ; attempt++) {
    if (search) {
      const wait = nextSearchAt - Date.now();

      if (wait > 0) {
        await Bun.sleep(wait);
      }

      nextSearchAt = Date.now() + SEARCH_GAP_MS;
    }

    const res = await fetch(url, { headers: { authorization: `Token ${key}` }, signal: signal ?? null });

    if (res.ok) {
      return schema.parse(await res.json());
    }

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
  const r = await call(
    "search/total-count",
    searchParams(query, sources, w),
    true,
    z.object({ count: z.object({ relevant: z.number() }) }),
    signal,
  );

  return r.count.relevant;
}

export async function countsBySource(query: string, sources: number[], w: Window, signal?: AbortSignal) {
  const r = await call(
    "search/sources",
    searchParams(query, sources, w),
    true,
    z.object({ sources: z.array(z.object({ source: z.string(), count: z.number() })) }),
    signal,
  );

  return Object.fromEntries(r.sources.map((s) => [s.source, s.count]));
}

const StoryPage = z.object({ stories: z.array(StoryJson), pagination_token: z.string().nullish() });

export async function stories(query: string, sources: number[], w: Window, signal?: AbortSignal): Promise<Story[]> {
  const out: Story[] = [];
  let token: string | null | undefined = null;

  do {
    const params: Record<string, string> = searchParams(query, sources, w);

    if (token !== null && token !== undefined && token !== "") {
      params.pagination_token = token;
    }

    const page = await call("search/story-list", params, true, StoryPage, signal);

    out.push(...page.stories);
    token = page.pagination_token;
  } while (token !== null && token !== undefined && token !== "");

  return out;
}

export interface Source {
  id: number;
  name: string;
  stories_per_week?: number | null | undefined;
  stories_total?: number | null | undefined;
  media_type?: string | null | undefined;
}

const SourceJson: z.ZodType<Source> = z.looseObject({
  id: z.number(),
  name: z.string(),
  stories_per_week: z.number().nullish(),
  stories_total: z.number().nullish(),
  media_type: z.string().nullish(),
});

export async function sourceByDomain(domain: string): Promise<Source | null> {
  const r = await call(
    "sources/sources/",
    { name: domain, platform: "online_news", limit: "10" },
    false,
    z.object({ results: z.array(SourceJson) }),
  );

  return r.results.find((s) => s.name === domain) ?? null;
}

const SourcePage = z.object({ results: z.array(SourceJson), next: z.string().nullish() });

export async function collectionSources(collectionId: number): Promise<Source[]> {
  const out: Source[] = [];
  let offset = 0;

  for (;;) {
    const r = await call(
      "sources/sources/",
      { collection_id: String(collectionId), limit: "1000", offset: String(offset) },
      false,
      SourcePage,
    );

    out.push(...r.results);

    if (r.next === null || r.next === undefined || r.next === "") {
      return out;
    }

    offset += r.results.length;
  }
}
