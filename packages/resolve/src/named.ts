import { appendFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { BillId, Row } from "@antibody/core";
import { billRef } from "@antibody/core";
import { paths } from "@antibody/core/node";
import { findNames, splitSections, type TextHit } from "./benefits.ts";
import { askJson } from "./claude.ts";
import type { Company } from "./edgar.ts";
import { norm } from "./normalize.ts";
import { ACCEPT } from "./review.ts";

const PROMPT = `Each item is a passage of a US bill where a public company's name seems to appear. Decide whether the bill text
really names that company (the listed SEC registrant or the same corporate group), as opposed to a government body, a program,
a place, a law, or an ordinary phrase that shares the words. A federal corporation or agency with no common stock is "no".

Return only a JSON array, one object per item, in order:
{"key": "<item key>", "named": true|false, "confidence": <0..1>, "reason": "<one short sentence>"}

Items:
`;

interface Verdict {
  key: string;
  named: boolean;
  confidence: number;
  reason: string;
}

const cacheFile = () => join(paths.raw("entities"), "resolve", "named-verdicts.jsonl");

/** The bill's text versions: the ones ingest-bills downloaded, else fetched from GovInfo into resolve's cache. */
async function versionTexts(
  bill: BillId,
  versions: Row<"versions">[],
): Promise<{ code: string; id: string | null; xml: string }[]> {
  const raw = join(paths.raw("bills"), "raw");
  const own = join(paths.raw("entities"), "resolve", "text");
  const list: { code: string; id: string | null; url: string | null; file: string }[] = versions.length
    ? versions.map((v) => ({ code: v.code, id: v.id, url: v.url, file: basename(v.url) }))
    : await (async () => {
        const { congress, type, number } = billRef(bill);
        const glob = new Bun.Glob(`BILLS-${congress}${type}${number}[a-z]*.xml`);
        const files = await Array.fromAsync(glob.scan({ cwd: raw })).catch(() => [] as string[]);
        return files.map((f) => ({
          code: f.replace(/^BILLS-\d+[a-z]+?\d+|\.xml$/g, ""),
          id: null,
          url: null,
          file: f,
        }));
      })();
  const read = async (v: (typeof list)[number]) => {
    for (const f of [join(raw, v.file), join(own, v.file)]) if (await Bun.file(f).exists()) return Bun.file(f).text();
    if (!v.url) return null;
    const res = await fetch(v.url);
    if (!res.ok) return null;
    const xml = await res.text();
    await mkdir(own, { recursive: true });
    await Bun.write(join(own, v.file), xml);
    return xml;
  };
  const out: { code: string; id: string | null; xml: string }[] = [];
  for (const v of list) {
    const xml = await read(v);
    if (xml) out.push({ code: v.code, id: v.id, xml });
  }
  return out;
}

/**
 * Rule "named-in-text": an SEC company written into any version of the bill, confirmed by the reviewer
 * (most capitalized look-alikes are agencies, programs and places). One row per company and section.
 */
export async function namedBenefits(
  bill: BillId,
  versions: Row<"versions">[],
  sections: Row<"sections">[],
  companies: Company[],
  log: (m: string) => void,
  signal?: AbortSignal,
): Promise<Row<"benefits">[]> {
  const texts = await versionTexts(bill, versions);
  const hits: (TextHit & { code: string; versionId: string | null })[] = [];
  for (const t of texts)
    for (const h of findNames(splitSections(t.xml), companies, norm))
      hits.push({ ...h, code: t.code, versionId: t.id });
  log(`named-in-text: ${hits.length} candidate mentions in ${texts.length} text versions`);
  if (!hits.length) return [];

  const keyOf = (h: TextHit) => {
    const x = new Bun.CryptoHasher("sha1");
    x.update(JSON.stringify(["named-1", h.cik, h.matched, h.context]));
    return x.digest("hex").slice(0, 16);
  };
  const cache = new Map<string, Verdict>();
  if (await Bun.file(cacheFile()).exists())
    for (const l of (await Bun.file(cacheFile()).text()).split("\n"))
      if (l) {
        const v = JSON.parse(l) as Verdict;
        cache.set(v.key, v);
      }
  const todo = [...new Map(hits.map((h) => [keyOf(h), h])).entries()].filter(([k]) => !cache.has(k));
  for (let i = 0; i < todo.length; i += 30) {
    const items = todo
      .slice(i, i + 30)
      .map(([key, h]) => ({ key, company: h.name, written: h.matched, passage: h.context }));
    const { items: verdicts } = await askJson<Verdict>(PROMPT + JSON.stringify(items), signal);
    const mine = verdicts.filter((v) => items.some((x) => x.key === v.key));
    await mkdir(join(paths.raw("entities"), "resolve"), { recursive: true });
    if (mine.length) await appendFile(cacheFile(), `${mine.map((v) => JSON.stringify(v)).join("\n")}\n`);
    for (const v of mine) cache.set(v.key, v);
  }

  const sectionId = (code: string, num: string | null) => {
    if (!num) return null;
    const found = sections.filter((s) => {
      const h = (s.history as Record<string, { path?: string }>)[code];
      return h?.path?.split("/").at(-1) === `sec:${num}`;
    });
    return found.length === 1 ? found[0]!.id : null;
  };
  const rows = new Map<string, Row<"benefits">>();
  for (const h of hits) {
    const v = cache.get(keyOf(h));
    if (!v?.named || v.confidence < ACCEPT) continue;
    const section = sectionId(h.code, h.num);
    const id = `${bill}:named-in-text:${h.cik}${section ? `:${section}` : ""}`;
    if (rows.has(id)) continue;
    rows.set(id, {
      id,
      bill_id: bill,
      section_id: section,
      company_id: h.cik,
      basis_rule: "named-in-text",
      rule: "tied-stock",
      confidence: v.confidence,
      rests_on: [
        section ? `sections/${section}` : h.versionId ? `versions/${h.versionId}` : `bills/${bill}`,
        `companies/${h.cik}`,
      ],
      evidence: { written: h.matched, quote: h.context, version: h.code, sectionNum: h.num, reason: v.reason },
    });
  }
  return [...rows.values()];
}
