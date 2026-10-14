import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";

const UA = "antibody/0.1 (+https://github.com/AVGVSTVS96/antibody)";

/** Downloads `url` to `file` once (atomically), then reads it from disk unless `refresh`. */
export async function cached(url: string, file: string, refresh = false): Promise<string> {
  const f = Bun.file(file);
  if (!refresh && (await f.exists())) return f.text();
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new FetchError(res.status, url);
  const body = await res.text();
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await Bun.write(tmp, body);
  await rename(tmp, file);
  return body;
}

export class FetchError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`${status} ${url}`);
  }
}
