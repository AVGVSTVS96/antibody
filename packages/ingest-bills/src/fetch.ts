import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { paths } from "@antibody/core/node";

export const RAW = join(paths.raw("bills"), "raw");

const HEADERS = { "User-Agent": "antibody/1 (+https://github.com/AVGVSTVS96/antibody)" };

export class NotFound extends Error {}

/** Downloads `url` once into data/bills/raw/<file> (again with `refresh`), retrying transient GovInfo errors. */
export async function cached(url: string, file: string, refresh = false, dir = RAW): Promise<string> {
  const path = join(dir, file);
  const local = Bun.file(path);
  if (!refresh && (await local.exists()) && local.size > 0) return local.text();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.ok) {
      const text = await res.text();
      await mkdir(dir, { recursive: true });
      await Bun.write(`${path}.tmp`, text);
      await rename(`${path}.tmp`, path);
      return text;
    }
    if (res.status === 404) throw new NotFound(`${res.status} ${url}`);
    if (attempt >= 3) throw new Error(`${res.status} ${url}`);
    await Bun.sleep(2000 * 2 ** attempt);
  }
}
