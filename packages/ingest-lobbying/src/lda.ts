import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DATA, paths } from "@antibody/core/node";

export const LDA = "https://lda.gov/api/v1";
const CACHE = join(paths.raw("lobbying"), "cache");

/** The key lives in the main checkout's .env; Bun only loads .env from the working directory. */
async function apiKey(): Promise<string | undefined> {
  if (process.env.LDA_API_KEY) return process.env.LDA_API_KEY;
  const env = Bun.file(join(dirname(DATA), ".env"));
  if (!(await env.exists())) return undefined;
  return (await env.text()).match(/^LDA_API_KEY=["']?([^"'\s]+)/m)?.[1];
}

const key = await apiKey();
/** 120 requests/min with a key, 15 without (lda.gov, checked Oct 13 2026). */
const spacingMs = key ? 520 : 4100;
let next = 0;

async function throttle() {
  const now = Date.now();
  const at = Math.max(now, next);
  next = at + spacingMs;
  if (at > now) await Bun.sleep(at - now);
}

export interface Page<T> {
  count: number;
  next: string | null;
  results: T[];
}

/** GET with a URL-keyed disk cache. `fresh` skips the cache read (still writes it). */
export async function get<T>(url: string, opts: { fresh?: boolean; signal?: AbortSignal } = {}): Promise<T> {
  await mkdir(CACHE, { recursive: true });
  const file = Bun.file(join(CACHE, `${createHash("sha1").update(url).digest("hex")}.json`));
  if (!opts.fresh && (await file.exists())) return file.json();
  for (let attempt = 1; ; attempt++) {
    opts.signal?.throwIfAborted();
    await throttle();
    const res = await fetch(url, { headers: key ? { Authorization: `Token ${key}` } : {}, signal: opts.signal });
    if (res.status === 429) {
      await Bun.sleep(Number(res.headers.get("retry-after") ?? 30) * 1000);
      continue;
    }
    if (!res.ok) {
      if (attempt < 4 && res.status >= 500) {
        await Bun.sleep(5000 * attempt);
        continue;
      }
      throw new Error(`lda.gov ${res.status}: ${url}`);
    }
    const body = await res.json();
    await Bun.write(file, JSON.stringify(body));
    return body as T;
  }
}

export function filingsUrl(params: Record<string, string | number>, page = 1): string {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  q.set("page_size", "25");
  q.set("page", String(page));
  return `${LDA}/filings/?${q}`;
}

/**
 * Every filing matching `params`. `count` is inflated (one hit per matching issue line), so callers dedupe by
 * filing_uuid; paging itself is stable (checked across three orderings in the spike).
 */
export async function* filings(
  params: Record<string, string | number>,
  opts: { fresh?: boolean; signal?: AbortSignal; concurrency?: number } = {},
): AsyncGenerator<LdaFiling> {
  const first = await get<Page<LdaFiling>>(filingsUrl(params), opts);
  yield* first.results;
  const pages = Math.ceil(first.count / 25);
  const step = opts.concurrency ?? 6;
  for (let start = 2; start <= pages; start += step) {
    const batch = Array.from({ length: Math.min(step, pages - start + 1) }, (_, i) =>
      get<Page<LdaFiling>>(filingsUrl(params, start + i), opts),
    );
    for (const page of await Promise.all(batch)) yield* page.results;
  }
}

export interface LdaLobbyist {
  lobbyist: {
    id: number;
    prefix_display: string | null;
    first_name: string;
    nickname: string | null;
    middle_name: string | null;
    last_name: string;
    suffix_display: string | null;
  };
  covered_position: string | null;
  new: boolean;
}

export interface LdaActivity {
  general_issue_code: string;
  description: string | null;
  lobbyists: LdaLobbyist[];
}

export interface LdaFiling {
  url: string;
  filing_uuid: string;
  filing_type: string;
  filing_year: number;
  filing_period: string;
  filing_document_url: string;
  income: string | null;
  expenses: string | null;
  dt_posted: string | null;
  registrant: { id: number; name: string };
  client: { id: number; client_id?: number; name: string; general_description: string | null };
  lobbying_activities: LdaActivity[];
}

/** Keeps only what the tables use: the raw cache repeats registrant and client details on every page. */
export function slim(f: LdaFiling): LdaFiling {
  return {
    url: f.url,
    filing_uuid: f.filing_uuid,
    filing_type: f.filing_type,
    filing_year: f.filing_year,
    filing_period: f.filing_period,
    filing_document_url: f.filing_document_url,
    income: f.income,
    expenses: f.expenses,
    dt_posted: f.dt_posted,
    registrant: { id: f.registrant.id, name: f.registrant.name },
    client: { id: f.client.id, name: f.client.name, general_description: f.client.general_description },
    lobbying_activities: (f.lobbying_activities ?? []).map((a) => ({
      general_issue_code: a.general_issue_code,
      description: a.description,
      lobbyists: (a.lobbyists ?? []).map((l) => ({
        lobbyist: {
          id: l.lobbyist.id,
          prefix_display: l.lobbyist.prefix_display ?? null,
          first_name: l.lobbyist.first_name,
          nickname: l.lobbyist.nickname ?? null,
          middle_name: l.lobbyist.middle_name,
          last_name: l.lobbyist.last_name,
          suffix_display: l.lobbyist.suffix_display,
        },
        covered_position: l.covered_position,
        new: l.new,
      })),
    })),
  };
}
