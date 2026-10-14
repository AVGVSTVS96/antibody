import { join } from "node:path";
import { type BillId, billDisplay, type Row, type StageContext } from "@antibody/core";
import { readRows, writeRows } from "@antibody/core/node";
import { billStatus } from "./billstatus.ts";
import { type Aliases, best, billNumbers, findRefs, matcher, period } from "./extract.ts";
import { askJson } from "./llm.ts";
import { readAliases } from "./lobbying.ts";
import { pullTerms, rawDir } from "./pull.ts";
import { clientRows, filingRow, markSuperseded, mergeClient, phaseOf } from "./rows.ts";
import { upsert } from "./shards.ts";
import { spendRows } from "./spend.ts";

const MODEL = "sonnet";
const BATCH = 40;
const KEEP = 0.6;
/** A topic-only line never reads as more certain than this, whatever the model says. */
const CAP = 0.8;

async function topicPhrases(a: Aliases, signal: AbortSignal) {
  const s = await billStatus(a.bill, signal);
  const prompt = `Federal lobbying reports (LD-2) often describe legislation by its subject instead of naming it,
e.g. "stablecoin legislation" or "the reconciliation bill". Give 1 to 4 short lowercase search phrases (1-3 words)
that such issue lines would contain when lobbying on THIS bill's subject. Each phrase must be distinctive: most
lines containing it should be about this subject. Prefer the subject's own term over generic words like "tax".

Bill: ${billDisplay(a.bill)} (${a.congress}th Congress), also known as ${a.names.map((n) => `"${n.text}"`).join(", ")}.
Policy area: ${s?.policyArea ?? "unknown"}.
CRS summary: ${(s?.summary ?? "").slice(0, 1500)}

Return only JSON: {"phrases": ["..."]}`;
  return askJson<{ phrases: string[] }>(prompt, MODEL, signal);
}

interface Candidate {
  i: number;
  filing: string;
  line: number;
  quarter: string;
  text: string;
  phrase: string;
}

interface Verdict {
  i: number;
  verdict: "this-bill" | "other" | "unclear";
  confidence: number;
  reason: string;
}

function classifyPrompt(a: Aliases, summary: string, batch: Candidate[]) {
  return `You label lines from federal lobbying disclosure reports (LD-2). The bill:
${billDisplay(a.bill)} (${a.congress}th Congress), known as ${a.names.map((n) => `"${n.text}"`).join(", ")};
earlier numbers: ${a.numbers.map((n) => billDisplay(n.id)).join(", ")}. Introduced ${a.introduced}${a.enactedOn ? `, law on ${a.enactedOn}` : ""}.
Summary: ${summary.slice(0, 800)}

Each line below is from a report for a quarter while the bill was pending, and names no bill number or title.
For each, decide what legislation the lobbying was on:
- "this-bill": legislation on the bill's subject that, in that quarter, can only reasonably mean this bill;
- "other": a different bill, a competing bill in the other chamber, a regulation, appropriations, or agency action;
- "unclear": it could mean several bills or just the topic in general.
Be conservative and judge each line on its own words. Return only a JSON array, one object per line:
{"i": <int>, "verdict": "this-bill|other|unclear", "confidence": <0..1>, "reason": "<one short sentence>"}

Lines:
${JSON.stringify(batch.map(({ i, quarter, text }) => ({ i, quarter, text })))}`;
}

const wordRe = (phrase: string) =>
  new RegExp(`(?<![A-Za-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}`, "i");

/**
 * Topic-only lobbying: lines that describe the bill's subject while it was pending without naming any bill.
 * A model proposes the search phrases from CRS's summary, lda.gov finds the lines, and the model judges each one;
 * kept lines become lda-topic-only inferences (drawn dashed, off by default).
 */
export async function runTopic(ctx: StageContext) {
  const bill = ctx.bill as BillId;
  if (!Bun.which("claude")) return ctx.log("skipped: the claude CLI is not on this machine");
  const a = await readAliases(bill);
  if (!a) throw new Error(`run the lobbying stage for ${bill} first`);
  const s = await billStatus(bill, ctx.signal);
  const m = matcher(a);
  const until = a.enactedOn ?? `${1789 + 2 * (a.congress - 1) + 1}-12-31`;
  const years = a.years.filter((y) => y <= Number(until.slice(0, 4)));
  let cost = 0;
  let ms = 0;
  let calls = 0;

  const phrases = await topicPhrases(a, ctx.signal);
  cost += phrases.costUsd;
  const terms = phrases.value.phrases.map((p) => `"${p.replaceAll('"', "")}"`);
  ctx.log(`topic phrases: ${phrases.value.phrases.join(", ")}`);
  const pulled = await pullTerms(bill, "topic-filings", terms, years, ctx);

  const candidates: Candidate[] = [];
  for (const f of pulled) {
    if (f.filing_type.startsWith("R")) continue;
    const p = period(f.filing_year, f.filing_period);
    if (!a.introduced || p.end < a.introduced || p.start > until) continue;
    const lines = f.lobbying_activities.map((x) => x.description ?? "");
    if (lines.some((t) => (best(findRefs(t, p, m))?.level ?? "low") !== "low")) continue;
    for (const [line, text] of lines.entries()) {
      if (billNumbers(text).length) continue;
      const phrase = phrases.value.phrases.find((ph) => wordRe(ph).test(text));
      if (!phrase) continue;
      const quarter = `${f.filing_year} ${f.filing_period.replace("_", " ")}`;
      candidates.push({ i: candidates.length, filing: f.filing_uuid, line, quarter, text: text.trim(), phrase });
    }
  }
  ctx.log(`${candidates.length} candidate lines in ${new Set(candidates.map((c) => c.filing)).size} filings`);

  const verdicts = new Map<number, Verdict>();
  const batches = Array.from({ length: Math.ceil(candidates.length / BATCH) }, (_, k) =>
    candidates.slice(k * BATCH, (k + 1) * BATCH),
  );
  for (let k = 0; k < batches.length; k += 3)
    await Promise.all(
      batches.slice(k, k + 3).map(async (batch) => {
        const ans = await askJson<Verdict[]>(classifyPrompt(a, s?.summary ?? "", batch), MODEL, ctx.signal);
        if (!ans.cached) [cost, ms, calls] = [cost + ans.costUsd, ms + ans.ms, calls + 1];
        for (const v of ans.value) verdicts.set(v.i, v);
      }),
    );

  const byUuid = new Map(pulled.map((f) => [f.filing_uuid, f]));
  const refs: Row<"lda_topic_refs">[] = [];
  for (const c of candidates) {
    const v = verdicts.get(c.i);
    if (v?.verdict !== "this-bill" || v.confidence < KEEP) continue;
    const f = byUuid.get(c.filing)!;
    const p = period(f.filing_year, f.filing_period);
    refs.push({
      id: `${c.filing}#${c.line}#${bill}`,
      filing_id: c.filing,
      bill_id: bill,
      line: c.line + 1,
      issue_code: f.lobbying_activities[c.line]!.general_issue_code,
      quote: c.text,
      topic: c.phrase,
      phase: phaseOf(p.start, p.end, a.enactedOn),
      source_url: f.filing_document_url,
      source_locator: `issue line ${c.line + 1} of ${f.lobbying_activities.length}`,
      rule: "lda-topic-only",
      confidence: Math.min(CAP, v.confidence),
      rests_on: [`lda_filings/${c.filing}`],
      evidence: { model: MODEL, phrase: c.phrase, verdict: v.verdict, confidence: v.confidence, reason: v.reason },
    });
  }

  const kept = [...new Set(refs.map((r) => r.filing_id))].map((id) => byUuid.get(id)!);
  const filings = kept.map(filingRow);
  await upsert("lda_filings", filings, (f) => String(f.year), { finish: markSuperseded });
  await upsert("lda_clients", clientRows(kept), () => "all", { merge: mergeClient });
  await writeRows("lda_topic_refs", bill, refs);
  const stored = new Map<string, Row<"lda_filings">>();
  for (const y of new Set(filings.map((f) => String(f.year))))
    for (const f of await readRows("lda_filings", y)) stored.set(f.id, f);
  await writeRows(
    "lda_spend",
    `${bill}-topic`,
    spendRows(
      bill,
      stored,
      refs.map((r) => ({ ...r, section_nums: [] })),
      true,
    ),
  );

  const counts = { "this-bill": 0, other: 0, unclear: 0 };
  for (const v of verdicts.values()) counts[v.verdict]++;
  const report = {
    phrases: phrases.value.phrases,
    candidates: candidates.length,
    verdicts: counts,
    kept: refs.length,
    calls,
    costUsd: cost,
    ms,
  };
  await Bun.write(join(rawDir(bill), "topic.json"), JSON.stringify(report, null, 1));
  ctx.log(
    `${refs.length} topic-only lines kept in ${kept.length} filings (${JSON.stringify(counts)}); ` +
      `${calls} model calls, $${cost.toFixed(2)}, ${(ms / 1000).toFixed(0)}s`,
  );
}
