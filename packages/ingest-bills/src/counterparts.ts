import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { BillId, Row } from "@antibody/core";
import { paths } from "@antibody/core/node";
import type { Lineage } from "./lineage.ts";
import { headingWords, intersect } from "./text.ts";

export const MODEL = "sonnet";
const CACHE = join(paths.raw("bills"), "llm");
const RULE =
  "llm-counterpart: a model read both sections and judged that the added one does the same job in law as the removed one, rewritten rather than copied";

const SCHEMA = {
  type: "object",
  properties: {
    pairs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          removed: { type: "string" },
          added: { type: ["string", "null"] },
          confidence: { type: "number" },
          reason: { type: "string" },
        },
        required: ["removed", "added", "confidence", "reason"],
      },
    },
  },
  required: ["pairs"],
};

const SYSTEM = `You compare sections of two versions of a US bill. Each item is a section that was in the earlier version and is gone from the later one, listed with sections that first appear in the later version.

A counterpart does the same job in law as the removed section: the same program, tax provision, agency power or policy lever, rewritten rather than copied. Example: the House's "Able bodied adults without dependents work requirements" and the Senate's "Modifications to SNAP work requirements for able-bodied adults" are counterparts. Sharing a topic is not enough: two different energy credits, or two unrelated grants to the same agency, are not counterparts.

For every item, answer with its key, the key of its counterpart or null when no candidate does the same job, a confidence from 0 to 1, and one sentence of reason that quotes the words in both texts that show it.`;

export interface CounterpartStep {
  from: string;
  to: string;
  fromName: string;
  toName: string;
  removed: Lineage[];
  added: Lineage[];
}

const preview = (l: Lineage, code: string, chars = 700) => {
  const s = l.history[code]!;
  return `${s.path} "${s.heading}": ${l.last.text.slice(0, chars)}`;
};

/** Added sections worth showing the model for one removed section: shared heading words, cited law or wording. */
export function candidates(r: Lineage, added: Lineage[], top = 6): Lineage[] {
  const hw = headingWords(r.last.heading);
  return added
    .map((a) => {
      const ahw = headingWords(a.last.heading);
      const shared = intersect(hw, ahw);
      const heading = shared / Math.max(1, hw.size + ahw.size - shared);
      const cites = intersect(r.last.cites, a.last.cites) > 0 ? 0.5 : 0;
      const small = Math.min(r.last.sh.size, a.last.sh.size);
      const wording = small ? intersect(r.last.sh, a.last.sh) / small : 0;
      return { a, score: heading + cites + wording, any: shared > 0 || cites > 0 || wording >= 0.1 };
    })
    .filter((c) => c.any)
    .sort((x, y) => y.score - x.score)
    .slice(0, top)
    .map((c) => c.a);
}

interface Answer {
  pairs: Pick[];
  costUsd: number | null;
}

/** One model call, cached by its exact prompt in data/bills/llm/ so a rerun never pays twice. */
async function ask(prompt: string, cacheKey: string): Promise<Answer & { fresh: boolean }> {
  const file = join(CACHE, `${cacheKey}.json`);
  if (await Bun.file(file).exists()) return { ...(await Bun.file(file).json()), fresh: false };
  let res: { structured_output?: { pairs: Pick[] }; total_cost_usd?: number; is_error?: boolean } = {};
  for (let attempt = 1; ; attempt++) {
    const proc = Bun.spawn(
      [
        "claude",
        "-p",
        "--model",
        MODEL,
        "--output-format",
        "json",
        "--no-session-persistence",
        "--system-prompt",
        SYSTEM,
        "--tools",
        "",
        "--strict-mcp-config",
        "--setting-sources",
        "",
        "--json-schema",
        JSON.stringify(SCHEMA),
      ],
      { stdin: new Blob([prompt]), stdout: "pipe", stderr: "pipe" },
    );
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    if ((await proc.exited) === 0) {
      res = JSON.parse(out);
      if (res.structured_output && !res.is_error) break;
    }
    if (attempt >= 3) throw new Error(`claude -p failed ${attempt}x: ${(err || out).slice(0, 500)}`);
    await Bun.sleep(5000 * attempt);
  }
  const answer: Answer = { pairs: res.structured_output?.pairs ?? [], costUsd: res.total_cost_usd ?? null };
  await mkdir(CACHE, { recursive: true });
  await Bun.write(file, JSON.stringify(answer));
  return { ...answer, fresh: true };
}

interface Pick {
  removed: string;
  added: string | null;
  confidence: number;
  reason: string;
}

export const canRun = () => Bun.which("claude") !== null && !process.env.CI;

/**
 * Pairs removed sections with added ones that rewrite them, which text matching misses (House SNAP work rules → the
 * Senate's). Each pair is an inference resting on both sections, with the model's reason as evidence.
 */
export async function counterparts(
  bill: BillId,
  steps: CounterpartStep[],
  log: (m: string) => void,
  batch = 12,
  parallel = 3,
): Promise<Row<"counterparts">[]> {
  const jobs: { step: CounterpartStep; items: { r: Lineage; cands: Lineage[] }[] }[] = [];
  for (const step of steps) {
    const items = step.removed.map((r) => ({ r, cands: candidates(r, step.added) })).filter((x) => x.cands.length);
    for (let i = 0; i < items.length; i += batch) jobs.push({ step, items: items.slice(i, i + batch) });
  }
  log(
    `counterparts: ${jobs.reduce((n, j) => n + j.items.length, 0)} removed sections with candidates, ${jobs.length} model calls`,
  );

  const rows: Row<"counterparts">[] = [];
  let cost = 0;
  let failed = 0;
  const run = async (job: (typeof jobs)[number]) => {
    const { step, items } = job;
    const keys = new Map<string, Lineage>();
    const blocks = items.map(({ r, cands }, i) => {
      keys.set(`R${i}`, r);
      const lines = cands.map((c, k) => {
        keys.set(`R${i}.A${k}`, c);
        return `  R${i}.A${k}: ${preview(c, step.to, 500)}`;
      });
      return `R${i}: ${preview(r, step.from)}\n  candidates first in the ${step.toName}:\n${lines.join("\n")}`;
    });
    const prompt = `Earlier version: ${step.fromName}. Later version: ${step.toName}.\n\n${blocks.join("\n\n")}`;
    const key = new Bun.CryptoHasher("sha256").update(`${MODEL}\n${SYSTEM}\n${prompt}`).digest("hex").slice(0, 24);
    const answer = await ask(prompt, `${bill}-${key}`).catch((e: Error) => {
      failed++;
      log(`counterparts: one batch of ${items.length} left unpaired: ${e.message}`);
      return null;
    });
    if (!answer) return;
    if (answer.fresh) cost += answer.costUsd ?? 0;
    for (const p of answer.pairs) {
      const r = keys.get(p.removed);
      const a = p.added ? keys.get(p.added) : undefined;
      if (!r || !a || !p.added?.startsWith(`${p.removed}.`) || p.confidence < 0.5) continue;
      rows.push({
        id: `${r.id}>${a.id}`,
        bill_id: bill,
        removed_section_id: r.id,
        added_section_id: a.id,
        rule: RULE,
        confidence: Math.round(Math.min(p.confidence, 0.9) * 100) / 100,
        rests_on: [`sections/${r.id}`, `sections/${a.id}`],
        evidence: {
          model: MODEL,
          reason: p.reason,
          step: `${step.from}->${step.to}`,
          candidates: items.find((x) => x.r === r)!.cands.map((c) => c.id),
        },
      });
    }
  };
  for (let i = 0; i < jobs.length; i += parallel) await Promise.all(jobs.slice(i, i + parallel).map(run));
  log(
    `counterparts: ${rows.length} pairs, $${cost.toFixed(2)} new model spend at list price${failed ? `, ${failed} batches failed` : ""}`,
  );
  return rows;
}
