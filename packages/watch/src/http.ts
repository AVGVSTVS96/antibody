import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";

const UA = "antibody/0.1 (+https://github.com/AVGVSTVS96/antibody)";

export interface GetOptions {
  accept?: string;
  headers?: Record<string, string>;
  method?: "GET" | "HEAD";
  signal?: AbortSignal | undefined;
}

export async function get(url: string, opts: GetOptions = {}): Promise<Response> {
  const headers = new Headers({ "User-Agent": UA });

  if (opts.accept !== undefined && opts.accept !== "") {
    headers.set("Accept", opts.accept);
  }

  for (const [name, value] of Object.entries(opts.headers ?? {})) {
    headers.set(name, value);
  }

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
    });

    if (res.ok) {
      return res;
    }

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

export const getText = async (url: string, opts?: GetOptions) => await (await get(url, opts)).text();

export async function cachedText(url: string, file: string, opts?: GetOptions): Promise<string> {
  const f = Bun.file(file);

  if (await f.exists()) {
    return await f.text();
  }

  const body = await getText(url, opts);
  await mkdir(dirname(file), { recursive: true });
  await Bun.write(`${file}.tmp`, body);
  await rename(`${file}.tmp`, file);

  return body;
}

export async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  const queue = items.entries();

  const worker = async () => {
    for (const [i, item] of queue) {
      out[i] = await fn(item);
    }
  };

  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));

  return out;
}
