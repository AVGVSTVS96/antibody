import { join } from "node:path";
import type { BillId, Row, Stage, StageContext } from "@antibody/core";
import { paths, python, readRows, writeRows } from "@antibody/core/node";
import { articleText, OUTLETS, searchPlan } from "@antibody/ingest-news";
import { attention } from "./attention.ts";
import { claudeAvailable, matchArticles, matchEmbed } from "./match.ts";
import { BOILERPLATE, SCORE, SCORE_TEXT, scoreRows, sectionDollars, sectionReports } from "./score.ts";

export { ATTENTION_RULE, attention, MIN_ARTICLES, MIN_SIDE_ARTICLES, MIN_TEXT_CHARS, percentile } from "./attention.ts";
export { EMBED_MATCHER, MATCH_MODEL, MATCHER } from "./match.ts";
export { buried, label, SCORE, SCORE_RULE, SCORE_TEXT, stakes } from "./score.ts";

const PKG = join(import.meta.dir, "..");

/** Published rules for the bundle's rules[]. */
export const RULES = [
  {
    id: "attention",
    version: "attention-v1",
    text:
      "News attention counts articles from a fixed, published outlet list, read by a language model that records " +
      "which sections each article discusses. Each side (left, center, right) is weighted equally. Trade and legal " +
      "press is shown apart and never counted.",
    url: null,
  },
  { id: "buried", version: SCORE.version, text: SCORE_TEXT.join(" "), url: null },
];

async function runAttention(ctx: StageContext) {
  const bill = ctx.bill as BillId;
  const sections = await readRows("sections", bill);
  if (!sections.length) throw new Error(`no sections for ${bill}: run the bills stage first`);
  const [b] = await readRows("bills", bill);
  const articles = await readRows("articles", bill);
  const read = articles.filter((a) => a.text_chars !== null);
  const outlet = new Map(OUTLETS.map((o) => [o.domain, o.name]));
  const input = await Promise.all(
    read.map(async (a) => ({
      id: a.id,
      outlet: outlet.get(a.outlet_id ?? "") ?? a.outlet_id ?? "unknown",
      title: a.title,
      text: a.text_chars ? await articleText(bill, a.id) : null,
    })),
  );
  const title = b?.short_title ?? b?.title ?? bill;
  const useClaude = process.env.ANTIBODY_MATCHER !== "embed" && (await claudeAvailable());
  if (!useClaude) ctx.log("claude -p unavailable: matching with local embeddings (the weaker fallback)");
  const run = useClaude
    ? await matchArticles(bill, title, sections, input, { refresh: ctx.refresh, log: ctx.log, signal: ctx.signal })
    : await matchEmbed(
        bill,
        title,
        (await searchPlan(bill)).query.match(/"([^"]+)"/g)?.map((q) => q.slice(1, -1)) ?? [],
        sections,
        input,
      );
  const res = attention(bill, sections, articles, run);
  await writeRows("attention", bill, res.rows);
  ctx.log(`${res.rows.length} attention rows from ${res.relevant} relevant articles (matcher ${run.model})`);
}

/** Off-topic distance for each final, non-boilerplate section, cached per bill. */
async function offTopic(bill: BillId, sections: Row<"sections">[]): Promise<Map<string, number>> {
  const items = sections
    .filter((s) => s.in_final && !BOILERPLATE.test(s.heading))
    .map((s) => ({ id: s.id, text: `${s.heading}. ${s.preview}` }));
  if (items.length < 4) return new Map();
  const dir = join(paths.raw("analyze"), "offtopic");
  const input = join(dir, `${bill}.in.json`);
  const output = join(dir, `${bill}.json`);
  const key = JSON.stringify(items);
  const prev = Bun.file(input);
  if (!(await prev.exists()) || (await prev.text()) !== key || !(await Bun.file(output).exists())) {
    await Bun.write(input, key);
    await python(PKG, "offtopic.py", [input, output], { memoryMax: "3G" });
  }
  const raw: Record<string, number> = (await Bun.file(output).json()).scores;
  const ids = Object.keys(raw);
  const values = ids.map((id) => raw[id]!).sort((a, b) => a - b);
  const rank = (v: number) => values.filter((x) => x < v).length / Math.max(values.length - 1, 1);
  return new Map(ids.map((id) => [id, Number(rank(raw[id]!).toFixed(4))]));
}

async function runScores(ctx: StageContext) {
  const bill = ctx.bill as BillId;
  const sections = await readRows("sections", bill);
  const att = await readRows("attention", bill);
  const dollars = sectionDollars(await readRows("cbo_estimates", bill), await readRows("cbo_lines", bill));
  const reports = sectionReports(
    sections.filter((s) => s.in_final),
    await readRows("lda_bill_refs", bill),
  );
  const rows = scoreRows(bill, sections, att, dollars, reports, await offTopic(bill, sections));
  await writeRows("section_scores", bill, rows);
  const n = (l: string) => rows.filter((r) => r.label === l).length;
  ctx.log(
    `${rows.length} final sections: ${n("headline")} headline, ${n("buried")} buried; ` +
      `dollars from ${dollars.estimate?.id ?? "no per-section CBO estimate"}`,
  );
}

export const stages: Stage[] = [
  { name: "attention", scope: "bill", needs: ["news", "bills"], writes: ["attention"], run: runAttention },
  {
    name: "scores",
    scope: "bill",
    needs: ["attention", "cbo", "lobbying"],
    writes: ["section_scores"],
    run: runScores,
  },
];
