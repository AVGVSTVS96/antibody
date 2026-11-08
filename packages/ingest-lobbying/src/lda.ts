import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DATA, paths } from "@antibody/core/node";
import { z } from "zod";

export const LDA = "https://lda.gov/api/v1";
const CACHE = join(paths.raw("lobbying"), "cache");

async function apiKey(): Promise<string | undefined> {
  const fromEnv = process.env.LDA_API_KEY;

  if (fromEnv !== undefined && fromEnv !== "") {
    return fromEnv;
  }

  const env = Bun.file(join(dirname(DATA), ".env"));

  if (!(await env.exists())) {
    return undefined;
  }

  return /^LDA_API_KEY=["']?([^"'\s]+)/mu.exec(await env.text())?.[1];
}

const key = await apiKey();

const spacingMs = key !== undefined && key !== "" ? 520 : 4100;
let next = 0;

async function throttle() {
  const now = Date.now();
  const at = Math.max(now, next);
  next = at + spacingMs;

  if (at > now) {
    await Bun.sleep(at - now);
  }
}

interface GetOptions {
  fresh?: boolean;
  signal?: AbortSignal | undefined;
}

export async function get<T>(url: string, schema: z.ZodType<T>, opts: GetOptions = {}): Promise<T> {
  await mkdir(CACHE, { recursive: true });
  const file = Bun.file(join(CACHE, `${createHash("sha1").update(url).digest("hex")}.json`));

  if (opts.fresh !== true && (await file.exists())) {
    return schema.parse(await file.json());
  }

  for (let attempt = 1; ; attempt++) {
    opts.signal?.throwIfAborted();
    await throttle();

    const res = await fetch(url, {
      headers: key !== undefined && key !== "" ? { Authorization: `Token ${key}` } : {},
      signal: opts.signal ?? null,
    });

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

    const body: unknown = await res.json();
    await Bun.write(file, JSON.stringify(body));

    return schema.parse(body);
  }
}

export function filingsUrl(params: URLSearchParams, page = 1): string {
  const q = new URLSearchParams(params);
  q.set("page_size", "25");
  q.set("page", String(page));

  return `${LDA}/filings/?${q.toString()}`;
}

export async function* filings(
  params: URLSearchParams,
  opts: GetOptions & { concurrency?: number } = {},
): AsyncGenerator<LdaFiling> {
  const first = await get(filingsUrl(params), FilingPage, opts);
  yield* first.results;
  const pages = Math.ceil(first.count / 25);
  const step = opts.concurrency ?? 6;

  for (let start = 2; start <= pages; start += step) {
    const batch = Array.from(
      { length: Math.min(step, pages - start + 1) },
      async (_, i) => await get(filingsUrl(params, start + i), FilingPage, opts),
    );

    for (const page of await Promise.all(batch)) {
      yield* page.results;
    }
  }
}

const LdaLobbyist = z.object({
  lobbyist: z.object({
    id: z.number(),
    prefix_display: z.string().nullable(),
    first_name: z.string(),
    nickname: z.string().nullable(),
    middle_name: z.string().nullable(),
    last_name: z.string().nullable(),
    suffix_display: z.string().nullable(),
  }),
  covered_position: z.string().nullable(),
  new: z.boolean().nullable(),
});

export type LdaLobbyist = z.infer<typeof LdaLobbyist>;

export const LdaFiling = z.object({
  url: z.string(),
  filing_uuid: z.string(),
  filing_type: z.string(),
  filing_year: z.number(),
  filing_period: z.string(),
  filing_document_url: z.string(),
  income: z.string().nullable(),
  expenses: z.string().nullable(),
  dt_posted: z.string().nullable(),
  registrant: z.object({ id: z.number(), name: z.string() }),
  client: z.object({
    id: z.number(),
    client_id: z.number().optional(),
    name: z.string(),
    general_description: z.string().nullable(),
  }),
  lobbying_activities: z.array(
    z.object({ general_issue_code: z.string(), description: z.string().nullable(), lobbyists: z.array(LdaLobbyist) }),
  ),
});

export type LdaFiling = z.infer<typeof LdaFiling>;

const FilingPage = z.object({ count: z.number(), next: z.string().nullable(), results: z.array(LdaFiling) });

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
