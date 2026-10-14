import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";

const UA = "antibody/0.1 (+https://github.com/AVGVSTVS96/antibody)";

export interface GetOptions {
  accept?: string;
  headers?: Record<string, string>;
  method?: "GET" | "HEAD";
  signal?: AbortSignal;
}

/** fetch with a named User-Agent, retrying 429 and 5xx with backoff. Throws on any other non-2xx. */
export async function get(url: string, opts: GetOptions = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: { "User-Agent": UA, ...(opts.accept ? { Accept: opts.accept } : {}), ...opts.headers },
      signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
    });
    if (res.ok) return res;
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await res.body?.cancel();
      const wait = Number(res.headers.get("retry-after")) || 5 * 2 ** attempt;
      await Bun.sleep(Math.min(wait, 120) * 1000);
      continue;
    }
    await res.body?.cancel();
    throw new Error(`${res.status} ${url}`);
  }
}

export const getText = async (url: string, opts?: GetOptions) => (await get(url, opts)).text();

/** Returns the file's text, downloading it first when it isn't on disk. For immutable URLs or versioned names. */
export async function cachedText(url: string, file: string, opts?: GetOptions): Promise<string> {
  const f = Bun.file(file);
  if (await f.exists()) return f.text();
  const body = await getText(url, opts);
  await mkdir(dirname(file), { recursive: true });
  await Bun.write(`${file}.tmp`, body);
  await rename(`${file}.tmp`, file);
  return body;
}

/** Maps `items` through `fn` with at most `n` in flight; keeps order. */
export async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
