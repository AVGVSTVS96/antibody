import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { paths } from "@antibody/core/node";
import { askJson, MODEL, pool } from "./claude.ts";
import { tokenSet } from "./fuzzy.ts";
import type { CompanyIndex, Match, Queued } from "./match.ts";
import { norm, normTicker } from "./normalize.ts";

const PROMPT_VERSION = "review-2";

const PROMPT = `You are resolving organization names from US public records (lobbying clients, PAC sponsors, stock-trade disclosures)
to SEC-registered public companies, so a reader can see which company's stock is affected.

For each item, decide how the organization relates to a public company:
- "same": the name is that company (allowing legal-suffix and spelling differences)
- "subsidiary": the name is a subsidiary, division, brand, US arm, or PAC of that company, so a member holding the parent's stock is exposed
- "none": no listed candidate is the organization or its parent (trade associations, nonprofits, governments, private firms, unrelated look-alikes)

Choose from the listed candidates when one fits. When the item says "may_propose_parent" and the organization is a subsidiary,
division or brand of a US-listed public company that is NOT among the candidates, answer "subsidiary" with cik null and give
parent_name and parent_ticker (its primary US ticker); it will be checked against the SEC list. Only do this when you know the
ownership is current, not a past owner.

Be conservative: a shared word is not a match, a politician's surname or a leadership PAC is never a company, a private
company with a similar name is "none", and an employee-owned or mutual company is "none". Confidence is your probability the
answer is right.

Return only a JSON array, one object per item, in order:
{"key": "<item key>", "relation": "same|subsidiary|none", "cik": "<candidate cik or null>", "parent_name": null, "parent_ticker": null,
 "confidence": <0..1>, "reason": "<one short sentence>"}

Items:
`;

export interface Verdict {
  key: string;
  relation: "same" | "subsidiary" | "none";
  cik: string | null;
  parent_name: string | null;
  parent_ticker: string | null;
  confidence: number;
  reason: string;
}

interface Cached {
  key: string;
  verdict: Verdict;
  model: string;
  at: string;
}

const cacheFile = () => join(paths.raw("entities"), "resolve", "review-verdicts.jsonl");

async function loadCache(): Promise<Map<string, Cached>> {
  const f = Bun.file(cacheFile());
  const out = new Map<string, Cached>();
  if (!(await f.exists())) return out;
  for (const line of (await f.text()).split("\n"))
    if (line) {
      const c = JSON.parse(line) as Cached;
      out.set(c.key, c);
    }
  return out;
}

function itemKey(q: Queued): string {
  const h = new Bun.CryptoHasher("sha1");
  h.update(
    JSON.stringify([
      PROMPT_VERSION,
      q.mention.name,
      q.mention.context,
      q.mayProposeParent,
      q.candidates.map((c) => c.cik),
    ]),
  );
  return h.digest("hex").slice(0, 16);
}

/** Accept a verdict only at this confidence or above; the spike's 0.6 "TALOS → Talos Energy" fell below it. */
export const ACCEPT = 0.8;

export interface ReviewStats {
  queued: number;
  cached: number;
  asked: number;
  calls: number;
  costUsd: number;
  seconds: number;
  failedBatches: number;
}

/**
 * The model judges each queued name against its candidates (or names a public parent outside them, which must
 * exist in SEC's ticker list under a matching name). Verdicts are cached per item, so reruns only ask about new names.
 */
export async function review(
  queued: Queued[],
  index: CompanyIndex,
  opts: { log: (m: string) => void; signal?: AbortSignal; batch?: number; parallel?: number },
): Promise<{ matches: Match[]; rejected: { q: Queued; verdict: Verdict | null; why: string }[]; stats: ReviewStats }> {
  const t0 = performance.now();
  const cache = await loadCache();
  const keyed = queued.map((q) => ({ q, key: itemKey(q) }));
  const todo = [...new Map(keyed.filter((k) => !cache.has(k.key)).map((k) => [k.key, k])).values()];
  const size = opts.batch ?? 30;
  const batches = Array.from({ length: Math.ceil(todo.length / size) }, (_, i) => todo.slice(i * size, (i + 1) * size));
  const stats: ReviewStats = {
    queued: queued.length,
    cached: queued.length - todo.length,
    asked: todo.length,
    calls: 0,
    costUsd: 0,
    seconds: 0,
    failedBatches: 0,
  };
  if (batches.length)
    opts.log(`review: ${todo.length} names in ${batches.length} ${MODEL} calls (${stats.cached} cached)`);
  await mkdir(join(paths.raw("entities"), "resolve"), { recursive: true });

  await pool(batches, opts.parallel ?? 4, async (batch, i) => {
    const items = batch.map(({ q, key }) => ({
      key,
      name: q.mention.name,
      kind: { client: "lobbying client", pac: "PAC sponsor", trade: "stock-trade asset" }[q.mention.source],
      context: q.mention.context,
      may_propose_parent: q.mayProposeParent,
      candidates: q.candidates.map((c) => ({ cik: c.cik, name: c.name, tickers: c.tickers.slice(0, 3) })),
    }));
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const {
          items: verdicts,
          costUsd,
          model,
        } = await askJson<Verdict>(PROMPT + JSON.stringify(items, null, 0), opts.signal);
        stats.calls++;
        stats.costUsd += costUsd;
        const at = new Date().toISOString();
        const lines = verdicts
          .filter((v) => batch.some((b) => b.key === v.key))
          .map((v) =>
            JSON.stringify({
              key: v.key,
              verdict: { ...v, cik: v.cik == null ? null : String(v.cik) },
              model,
              at,
            } satisfies Cached),
          );
        if (lines.length) await appendFile(cacheFile(), `${lines.join("\n")}\n`);
        for (const l of lines) {
          const c = JSON.parse(l) as Cached;
          cache.set(c.key, c);
        }
        opts.log(
          `review batch ${i + 1}/${batches.length}: ${lines.length}/${batch.length} verdicts, $${costUsd.toFixed(3)}`,
        );
        return;
      } catch (e) {
        opts.log(`review batch ${i + 1} attempt ${attempt} failed: ${(e as Error).message.slice(0, 200)}`);
      }
    }
    stats.failedBatches++;
  });

  const matches: Match[] = [];
  const rejected: { q: Queued; verdict: Verdict | null; why: string }[] = [];
  for (const { q, key } of keyed) {
    const c = cache.get(key);
    const v = c?.verdict ?? null;
    const base = { normalized: q.normalized, queuedBecause: q.why, candidates: q.candidates, model: c?.model ?? null };
    if (!v) {
      rejected.push({ q, verdict: null, why: "no verdict" });
      continue;
    }
    if (v.relation === "none" || v.confidence < ACCEPT) {
      rejected.push({
        q,
        verdict: v,
        why: v.relation === "none" ? "model: none" : `model confidence ${v.confidence} < ${ACCEPT}`,
      });
      continue;
    }
    const picked = v.cik ? q.candidates.find((x) => x.cik === v.cik) : undefined;
    if (picked) {
      matches.push({
        mention: q.mention,
        cik: picked.cik,
        method: v.relation === "same" ? "llm_same" : "llm_subsidiary",
        confidence: v.confidence,
        evidence: { ...base, reason: v.reason },
      });
      continue;
    }
    const parent =
      v.relation === "subsidiary" && q.mayProposeParent && v.parent_ticker
        ? index.byTicker.get(normTicker(v.parent_ticker))
        : undefined;
    const agrees = parent && v.parent_name ? tokenSet(norm(v.parent_name), norm(parent.name)) >= 80 : false;
    if (parent && agrees && v.confidence >= 0.85) {
      matches.push({
        mention: q.mention,
        cik: parent.cik,
        method: "llm_parent",
        confidence: v.confidence,
        evidence: {
          ...base,
          reason: v.reason,
          parentName: v.parent_name,
          parentTicker: v.parent_ticker,
          edgarName: parent.name,
        },
      });
      continue;
    }
    rejected.push({
      q,
      verdict: v,
      why: v.cik ? "model picked a CIK outside the candidates" : "proposed parent not confirmed in SEC's list",
    });
  }
  stats.seconds = Math.round((performance.now() - t0) / 1000);
  return { matches, rejected, stats };
}
