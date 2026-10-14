import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { type BillId, billRef } from "@antibody/core";
import { paths } from "@antibody/core/node";
import type { Aliases } from "./extract.ts";
import { acronyms, transpositions } from "./extract.ts";
import { filings, type LdaFiling, slim } from "./lda.ts";

const SPELLINGS: Record<string, string[]> = {
  hr: ["H.R. #", "H.R.#", "HR #", "HR#", "H. R. #"],
  s: ["S. #", "S.#", "S#", "S #"],
  hjres: ["H.J.Res. #", "H.J. Res. #", "H.J.Res.#", "HJRes #", "H.J.RES. #"],
  sjres: ["S.J.Res. #", "S.J. Res. #", "S.J.Res.#", "SJRes #", "S.J.RES. #"],
  hconres: ["H.Con.Res. #", "H. Con. Res. #", "H.Con.Res.#", "HConRes #"],
  sconres: ["S.Con.Res. #", "S. Con. Res. #", "S.Con.Res.#", "SConRes #"],
  hres: ["H.Res. #", "H. Res. #", "H.Res.#", "HRes #"],
  sres: ["S.Res. #", "S. Res. #", "S.Res.#", "SRes #"],
};

/** Quoted phrases for lda.gov's issue-text search: every spelling of every number, the names, typos, the law. */
export function searchTerms(a: Aliases): string[] {
  const terms = new Set<string>();
  for (const n of a.numbers) {
    const { type, number } = billRef(n.id);
    for (const s of SPELLINGS[type]!) terms.add(s.replace("#", String(number)));
  }
  for (const n of a.names) {
    terms.add(n.text);
    for (const ac of acronyms(n.title)) terms.add(ac);
    const words = n.text.split(/\s+/);
    for (const [i, w] of words.entries())
      if (/^[A-Z]{5,}$/.test(w))
        for (const typo of transpositions(w)) terms.add([...words.slice(0, i), typo, ...words.slice(i + 1)].join(" "));
  }
  for (const law of a.laws) terms.add(law);
  return [...terms].map((t) => `"${t.replaceAll('"', "")}"`);
}

/** lda.gov handles long OR queries, but keep each one modest. */
function queries(terms: string[], per = 20): string[] {
  const out: string[] = [];
  for (let i = 0; i < terms.length; i += per) out.push(terms.slice(i, i + per).join(" OR "));
  return out;
}

interface Manifest {
  /** `<query>|<year>` → when it was last pulled, so a refresh asks only for filings posted since. */
  done: Record<string, string>;
}

export const rawDir = (bill: BillId) => join(paths.raw("lobbying"), bill);

export async function readFilings(bill: BillId): Promise<LdaFiling[]> {
  const file = Bun.file(join(rawDir(bill), "filings.jsonl"));
  if (!(await file.exists())) return [];
  return (await file.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/**
 * Pulls every filing whose issue text matches one of the terms, per filing year, and merges them into
 * data/lobbying/<bill>/filings.jsonl. Queries already pulled are skipped unless `refresh`, which asks only
 * for filings posted since the last pull.
 */
export async function pull(
  a: Aliases,
  opts: { refresh: boolean; signal?: AbortSignal; log?: (m: string) => void },
): Promise<LdaFiling[]> {
  const dir = rawDir(a.bill);
  await mkdir(dir, { recursive: true });
  const manifestFile = Bun.file(join(dir, "manifest.json"));
  const manifest: Manifest = (await manifestFile.exists()) ? await manifestFile.json() : { done: {} };
  const byUuid = new Map((await readFilings(a.bill)).map((f) => [f.filing_uuid, f]));
  const before = byUuid.size;

  for (const q of queries(searchTerms(a)))
    for (const year of a.years) {
      const key = `${q}|${year}`;
      const last = manifest.done[key];
      if (last !== undefined && !opts.refresh) continue;
      const params: Record<string, string | number> = { filing_specific_lobbying_issues: q, filing_year: year };
      if (last) params.filing_dt_posted_after = new Date(Date.parse(last) - 2 * 86_400_000).toISOString().slice(0, 10);
      const pulledAt = new Date().toISOString();
      let n = 0;
      for await (const f of filings(params, { fresh: !!last, signal: opts.signal })) {
        byUuid.set(f.filing_uuid, slim(f));
        n++;
      }
      manifest.done[key] = pulledAt;
      opts.log?.(`${year} ${q.slice(0, 50)}… ${n} hits`);
    }

  const all = [...byUuid.values()];
  await Bun.write(join(dir, "filings.jsonl"), all.map((f) => JSON.stringify(f)).join("\n") + (all.length ? "\n" : ""));
  await Bun.write(manifestFile, JSON.stringify(manifest, null, 1));
  opts.log?.(`${all.length} filings (${all.length - before} new)`);
  return all;
}
