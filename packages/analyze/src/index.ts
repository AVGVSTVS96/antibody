import { join } from "node:path";
import type { BillId, Row, Stage, StageContext } from "@antibody/core";
import { paths, python, readRows, writeRows } from "@antibody/core/node";
import { sectionTexts } from "@antibody/ingest-bills";
import { articleText, OUTLETS, searchPlan } from "@antibody/ingest-news";
import { attention, MIN_TEXT_CHARS } from "./attention.ts";
import { type ArticleIn, cachedMatchRun, claudeAvailable, matchArticles, matchEmbed, subjectOf } from "./match.ts";
import { reach } from "./reach.ts";
import { CHECK_RULE, recheck } from "./recheck.ts";
import { BOILERPLATE, SCORE, SCORE_TEXT, scoreRows, sectionDollars, sectionReports, stakes } from "./score.ts";

export {
  ATTENTION_RULE,
  attention,
  MIN_ARTICLES,
  MIN_SECTION_HITS,
  MIN_SIDE_ARTICLES,
  MIN_TEXT_CHARS,
  percentile,
} from "./attention.ts";
export { EMBED_MATCHER, MATCH_MODEL, MATCHER } from "./match.ts";
export { PATTERNS, REACH_VERSION, reach } from "./reach.ts";
export { buried, label, NAMES_BILL, SCORE, SCORE_RULE, SCORE_TEXT, stakes } from "./score.ts";

const PKG = join(import.meta.dir, "..");

/** Published rules for the bundle's rules[]. */
export const RULES = [
  {
    id: "attention-v1",
    version: "1",
    text:
      "News attention counts articles from a fixed, published outlet list, read by a language model that records " +
      "which sections each article discusses. Each side (left, center, right) is weighted equally. Trade and legal " +
      "press is shown apart and never counted.",
    url: null,
  },
  { id: "buried-v5", version: "5", text: SCORE_TEXT.join(" "), url: null },
];

/** What the matcher and the quiet check read for a bill: its sections, the articles read, and the bill's names. */
async function coverage(bill: BillId) {
  const rows = await readRows("sections", bill);
  if (!rows.length) throw new Error(`no sections for ${bill}: run the bills stage first`);
  const unnamed = rows.filter((s) => !s.heading.trim());
  const texts = unnamed.length ? await sectionTexts(unnamed, await readRows("versions", bill)) : new Map();
  const sections = rows.map((s) => {
    const subject = texts.has(s.id) ? subjectOf(texts.get(s.id)!.text) : "";
    return subject ? { ...s, heading: `(unnamed; about: ${subject})` } : s;
  });
  const [b] = await readRows("bills", bill);
  const articles = await readRows("articles", bill);
  const read = articles.filter((a) => (a.text_chars ?? 0) >= MIN_TEXT_CHARS);
  const outlet = new Map(OUTLETS.map((o) => [o.domain, o.name]));
  const input: ArticleIn[] = await Promise.all(
    read.map(async (a) => ({
      id: a.id,
      outlet: outlet.get(a.outlet_id ?? "") ?? a.outlet_id ?? "unknown",
      title: a.title,
      text: await articleText(bill, a.id),
    })),
  );
  const title = b?.short_title ?? b?.title ?? bill;
  const names = (await searchPlan(bill)).query.match(/"([^"]+)"/g)?.map((q) => q.slice(1, -1)) ?? [];
  return { sections, articles, input, title, names };
}

async function runAttention(ctx: StageContext) {
  const bill = ctx.bill as BillId;
  const { sections, articles, input, title, names } = await coverage(bill);
  const useClaude = process.env.ANTIBODY_MATCHER !== "embed" && (await claudeAvailable());
  if (!useClaude) ctx.log("claude -p unavailable: matching with local embeddings (the weaker fallback)");
  const run = useClaude
    ? await matchArticles(bill, title, sections, input, {
        names,
        refresh: ctx.refresh,
        log: ctx.log,
        signal: ctx.signal,
      })
    : await matchEmbed(bill, title, names, sections, input);
  const res = attention(bill, sections, articles, run);
  await writeRows("attention", bill, res.rows);
  ctx.log(`${res.rows.length} attention rows from ${res.relevant} relevant articles (matcher ${run.model})`);
}

/** The filings a bill's lobbying references point to (the table is sharded by year, so it is read whole and trimmed). */
async function filingsOf(refs: Row<"lda_bill_refs">[]) {
  const named = new Set(refs.map((r) => r.filing_id));
  return new Map((await readRows("lda_filings")).filter((f) => named.has(f.id)).map((f) => [f.id, f]));
}

/** Stakes of each final section from the bill's CBO figures, lobbying firms and reach, as the scores stage reads them. */
async function stakesBySection(bill: BillId, sections: Row<"sections">[]) {
  const reachOf = Map.groupBy(await readRows("section_reach", bill), (r) => r.section_id);
  const dollars = sectionDollars(await readRows("cbo_estimates", bill), await readRows("cbo_lines", bill));
  const refs = await readRows("lda_bill_refs", bill);
  const reports = sectionReports(
    sections.filter((s) => s.in_final),
    refs,
    await filingsOf(refs),
  );
  const by = new Map(
    sections.map((s) => {
      const d = dollars.bySection.get(s.id);
      return [
        s.id,
        stakes({
          dollarsMusd: d ? d.musd : null,
          dollarsSplit: d?.split ?? null,
          lobbyingFirms: reports.get(s.id)?.firms.length ?? 0,
          reach: reachOf.get(s.id)?.map((r) => r.kind),
        }),
      ] as const;
    }),
  );
  return { dollars, reports, stakes: by };
}

/**
 * A second look at the sections the buried rule would call quiet with big stakes: the matcher picks sections from a
 * shortlist per article, so a provision the press describes in other words (a "$2,000 cap" for a Part D "benefit
 * redesign") can read as untouched. The news passages closest in meaning to each such section go to a model.
 */
async function runCheck(ctx: StageContext) {
  const bill = ctx.bill as BillId;
  const { sections, articles, input, title, names } = await coverage(bill);
  const att = await readRows("attention", bill);
  const final = sections.filter((s) => s.in_final);
  const run = await cachedMatchRun(bill);
  const ranked = att.some((a) => a.section_id && a.pct !== null);
  if (!run || !ranked || final.length < SCORE.minSections) {
    await writeRows("attention_checks", bill, []);
    ctx.log(
      !ranked ? "sections are not ranked: nothing to check" : "too few sections for the buried rule: nothing to check",
    );
    return;
  }
  const res = attention(bill, sections, articles, run);
  const money = await stakesBySection(bill, sections);
  const shareOf = new Map(att.flatMap((a) => (a.section_id ? [[a.section_id, a] as const] : [])));
  const candidates = final.filter((s) => {
    const a = shareOf.get(s.id);
    const share = a ? (a.evidence as { balanced_share: number }).balanced_share : null;
    return (
      a && a.pct !== null && share !== null && share < SCORE.quietShare && money.stakes.get(s.id)! >= SCORE.costlyMin
    );
  });
  const countedIds = new Set(res.counted.map((a) => a.id));
  const pool = input.filter((a) => countedIds.has(a.id));
  const checked = await recheck(bill, title, names, candidates, pool, {
    pkg: PKG,
    refresh: ctx.refresh,
    log: ctx.log,
    signal: ctx.signal,
  });
  const rows = candidates.map((s): Row<"attention_checks"> => {
    const a = shareOf.get(s.id)!;
    const had = new Set(a.hits ? a.rests_on.filter((r) => r.startsWith("articles/")).map((r) => r.slice(9)) : []);
    const r = checked.results[s.id]!;
    const found = r.yes.filter((id) => countedIds.has(id) && !had.has(id));
    return {
      id: `${bill}:${s.id}`,
      bill_id: bill,
      section_id: s.id,
      passages: r.passages.length,
      article_ids: found,
      share: Number(res.shareOf([...had, ...found]).toFixed(5)),
      rule: CHECK_RULE,
      confidence: 0.7,
      rests_on: [`sections/${s.id}`, `attention/${a.id}`, ...found.map((id) => `articles/${id}`)],
      evidence: {
        checker: checked.checker,
        model: checked.model,
        matcher_hits: a.hits,
        judged_yes: r.yes,
        passages: r.passages,
      },
    };
  });
  await writeRows("attention_checks", bill, rows);
  const more = rows.filter((r) => r.article_ids.length).length;
  ctx.log(
    `${candidates.length} quiet-looking sections with big stakes checked: ${more} had coverage the matcher missed`,
  );
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

/** Tags every section the bill ever had, removed ones too, with the reach its last text has (reach-v1). */
async function runReach(ctx: StageContext) {
  const bill = ctx.bill as BillId;
  const sections = await readRows("sections", bill);
  if (!sections.length) throw new Error(`no sections for ${bill}: run the bills stage first`);
  const texts = await sectionTexts(sections, await readRows("versions", bill));
  const rows = sections.flatMap((s): Row<"section_reach">[] => {
    const t = texts.get(s.id);
    return t
      ? reach(t.text).map((tag) => ({
          id: `${s.id}#${tag.kind}`,
          bill_id: bill,
          section_id: s.id,
          kind: tag.kind,
          pattern: tag.pattern,
          quote: tag.quote,
          version: t.version,
          source_url: t.url,
          source_locator: `${t.path
            .replace(/\//g, ", ")
            .replace(/:/g, " ")
            .replace(/\bsec /, "sec. ")}, the sentence quoted`,
        }))
      : [];
  });
  await writeRows("section_reach", bill, rows);
  const missing = sections.length - texts.size;
  const kinds = Object.entries(Object.groupBy(rows, (r) => r.kind)).map(([k, v]) => `${v!.length} ${k}`);
  ctx.log(
    `${new Set(rows.map((r) => r.section_id)).size} of ${sections.length} sections have reach${kinds.length ? ` (${kinds.join(", ")})` : ""}${missing ? `; ${missing} sections' text not found` : ""}`,
  );
}

async function runScores(ctx: StageContext) {
  const bill = ctx.bill as BillId;
  const sections = await readRows("sections", bill);
  const att = await readRows("attention", bill);
  const checks = await readRows("attention_checks", bill);
  const dollars = sectionDollars(await readRows("cbo_estimates", bill), await readRows("cbo_lines", bill));
  const refs = await readRows("lda_bill_refs", bill);
  const reports = sectionReports(
    sections.filter((s) => s.in_final),
    refs,
    await filingsOf(refs),
  );
  const rows = scoreRows(
    bill,
    sections,
    att,
    dollars,
    reports,
    await offTopic(bill, sections),
    checks,
    await readRows("counterparts", bill),
    await readRows("section_reach", bill),
  );
  await writeRows("section_scores", bill, rows);
  const n = (l: string) => rows.filter((r) => r.label === l).length;
  const cleared = rows.filter((r) => r.late_cleared_by).length;
  const onReach = rows.filter(
    (r) =>
      r.label === "buried" &&
      stakes({ dollarsMusd: r.dollars_musd, dollarsSplit: r.dollars_split, lobbyingFirms: r.lobbying_firms }) <
        SCORE.costlyMin,
  ).length;
  ctx.log(
    `${rows.length} final sections: ${n("headline")} headline, ${n("buried")} buried${onReach ? ` (${onReach} on reach alone)` : ""}${cleared ? `, ${cleared} not late after the counterpart check` : ""}; ` +
      `dollars from ${dollars.estimates.map((e) => e.id).join(" and ") || "no per-section CBO estimate"}`,
  );
}

export const stages: Stage[] = [
  { name: "attention", scope: "bill", needs: ["news", "bills"], writes: ["attention"], run: runAttention },
  { name: "reach", scope: "bill", needs: ["bills"], writes: ["section_reach"], run: runReach },
  {
    name: "quiet-check",
    scope: "bill",
    needs: ["attention", "cbo", "lobbying", "reach"],
    writes: ["attention_checks"],
    run: runCheck,
  },
  {
    name: "scores",
    scope: "bill",
    needs: ["attention", "bills", "cbo", "lobbying", "reach", "quiet-check"],
    writes: ["section_scores"],
    run: runScores,
  },
];
