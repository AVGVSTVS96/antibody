import { join } from "node:path";
import type { BillId, Row, Stage, StageContext } from "@antibody/core";
import { paths, python, readRows, writeRows } from "@antibody/core/node";
import { PARTS_TEXT, sectionParts, sectionTexts } from "@antibody/ingest-bills";
import { articleText, OUTLETS, searchPlan } from "@antibody/ingest-news";
import { z } from "zod";
import { attention, MIN_TEXT_CHARS } from "./attention.ts";
import { cachedMatchRun, claudeAvailable, matchArticles, matchEmbed, subjectOf, withParts } from "./match.ts";
import type { ArticleIn } from "./match.ts";
import { PARTS_VERSION, partRows, partSections } from "./parts.ts";
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

export { asSection, PARTS_VERSION, partLocator, partRows, partSections } from "./parts.ts";

export { PATTERNS, REACH_VERSION, reach } from "./reach.ts";

export { buried, label, NAMES_BILL, SCORE, SCORE_RULE, SCORE_TEXT, stakes } from "./score.ts";

const PKG = join(import.meta.dir, "..");

const BalancedShare = z.object({ balanced_share: z.number() });

const OffTopicFile = z.object({ scores: z.record(z.string(), z.number()) });

function billOf(ctx: StageContext): BillId {
  if (ctx.bill === null) {
    throw new Error("this stage runs per bill");
  }

  return ctx.bill;
}

const isPartRow = (r: { part_id: string | null }) => r.part_id !== null && r.part_id !== "";

export const RULES = [
  {
    id: "attention-v2",
    version: "2",
    text:
      "News attention counts articles from a fixed, published outlet list, read by a language model that records " +
      "which sections each article discusses. Each side (left, center, right) is weighted equally. Trade and legal " +
      "press is shown apart and never counted.",
    url: null,
  },
  { id: "buried-v5", version: "5", text: SCORE_TEXT.join(" "), url: null },
  { id: PARTS_VERSION, version: "1", text: PARTS_TEXT.join(" "), url: null },
];

async function coverage(bill: BillId) {
  const rows = await readRows("sections", bill);

  if (!rows.length) {
    throw new Error(`no sections for ${bill}: run the bills stage first`);
  }

  const unnamed = rows.filter((s) => !s.heading.trim());

  const texts =
    unnamed.length > 0 ? await sectionTexts(unnamed, await readRows("versions", bill)) : new Map<string, never>();

  const sections = rows.map((s) => {
    const t = texts.get(s.id);
    const subject = t === undefined ? "" : subjectOf(t.text);

    return subject ? { ...s, heading: `(unnamed; about: ${subject})` } : s;
  });

  const partRowsRead = await readRows("section_parts", bill);
  const partById = new Map(partRowsRead.map((r) => [r.id, r]));

  const parts = partSections(rows, partRowsRead).map((p) => {
    const row = partById.get(p.id);

    if (row === undefined) {
      throw new Error(`part ${p.id} has no section_parts row`);
    }

    const subject = row.heading ? "" : subjectOf(row.preview);

    return {
      ...p,
      heading: subject ? `(unnamed; about: ${subject}) ${p.heading}` : p.heading,
      parent: row.section_id,
    };
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
  const names = (await searchPlan(bill)).query.match(/"([^"]+)"/gu)?.map((q) => q.slice(1, -1)) ?? [];

  return { sections, parts, partRows: partRowsRead, articles, input, title, names };
}

async function runAttention(ctx: StageContext) {
  const bill = billOf(ctx);
  const { sections, parts, partRows: partList, articles, input, title, names } = await coverage(bill);
  const useClaude = process.env.ANTIBODY_MATCHER !== "embed" && (await claudeAvailable());

  if (!useClaude) {
    ctx.log("claude -p unavailable: matching with local embeddings (the weaker fallback)");
  }

  const run = useClaude
    ? await matchArticles(bill, title, sections, input, {
        names,
        refresh: ctx.refresh,
        log: ctx.log,
        signal: ctx.signal,
        parts,
      })
    : await matchEmbed(bill, title, names, withParts(sections, parts), input);

  const res = attention(bill, sections, articles, run, partList);
  await writeRows("attention", bill, res.rows);
  ctx.log(`${res.rows.length} attention rows from ${res.relevant} relevant articles (matcher ${run.model})`);
}

async function filingsOf(refs: Row<"lda_bill_refs">[]) {
  const named = new Set(refs.map((r) => r.filing_id));

  return new Map((await readRows("lda_filings")).filter((f) => named.has(f.id)).map((f) => [f.id, f]));
}

async function stakesBySection(bill: BillId, sections: Row<"sections">[], parts: Row<"section_parts">[] = []) {
  const tags = await readRows("section_reach", bill);

  const reachOf = Map.groupBy(
    tags.filter((r) => !isPartRow(r)),
    (r) => r.section_id,
  );

  const partReach = Map.groupBy(
    tags.flatMap((r) => (r.part_id === null || r.part_id === "" ? [] : [{ partId: r.part_id, kind: r.kind }])),
    (r) => r.partId,
  );

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

  for (const p of parts) {
    by.set(p.id, stakes({ dollarsMusd: null, lobbyingFirms: 0, reach: partReach.get(p.id)?.map((r) => r.kind) }));
  }

  return { dollars, reports, stakes: by };
}

async function runCheck(ctx: StageContext) {
  const bill = billOf(ctx);
  const { sections, parts, partRows: partList, articles, input, title, names } = await coverage(bill);
  const att = await readRows("attention", bill);
  const final = sections.filter((s) => s.in_final);
  const parentOf = new Map(parts.map((p) => [p.id, p.parent]));
  const run = await cachedMatchRun(bill);
  const ranked = att.some((a) => a.section_id !== null && a.section_id !== "" && a.pct !== null);

  if (!run || !ranked || final.length < SCORE.minSections) {
    await writeRows("attention_checks", bill, []);
    ctx.log(
      ranked ? "too few sections for the buried rule: nothing to check" : "sections are not ranked: nothing to check",
    );

    return;
  }

  const res = attention(bill, sections, articles, run, partList);
  const money = await stakesBySection(bill, sections, partList);

  const shareOf = new Map(
    att.flatMap((a) => (a.section_id === null || a.section_id === "" ? [] : [[a.part_id ?? a.section_id, a] as const])),
  );

  const quietCostly = [...final, ...parts.filter((p) => p.in_final)].flatMap((s) => {
    const a = shareOf.get(s.id);

    if (a === undefined || a.pct === null) {
      return [];
    }

    const share = BalancedShare.safeParse(a.evidence).data?.balanced_share;
    const costly = (money.stakes.get(s.id) ?? 0) >= SCORE.costlyMin;

    return share !== undefined && share < SCORE.quietShare && costly ? [{ s, a }] : [];
  });

  const candidates = quietCostly.map((c) => c.s);

  const countedIds = new Set(res.counted.map((a) => a.id));
  const pool = input.filter((a) => countedIds.has(a.id));

  const checked = await recheck(bill, title, names, candidates, pool, {
    pkg: PKG,
    refresh: ctx.refresh,
    log: ctx.log,
    signal: ctx.signal,
  });

  const rows = quietCostly.map(({ s, a }): Row<"attention_checks"> => {
    const had = new Set(a.hits ? a.rests_on.flatMap((r) => (r.startsWith("articles/") ? [r.slice(9)] : [])) : []);
    const r = checked.results[s.id];

    if (r === undefined) {
      throw new Error(`quiet check has no result for ${s.id}`);
    }

    const found = r.yes.filter((id) => countedIds.has(id) && !had.has(id));
    const parent = parentOf.get(s.id);
    const isPart = parent !== undefined && parent !== "";

    return {
      id: `${bill}:${s.id}`,
      bill_id: bill,
      section_id: parent ?? s.id,
      part_id: isPart ? s.id : null,
      passages: r.passages.length,
      article_ids: found,
      share: Number(res.shareOf([...had, ...found]).toFixed(5)),
      rule: CHECK_RULE,
      confidence: 0.7,
      rests_on: [
        isPart ? `section_parts/${s.id}` : `sections/${s.id}`,
        `attention/${a.id}`,
        ...found.map((id) => `articles/${id}`),
      ],
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

async function offTopic(bill: BillId, sections: Row<"sections">[]): Promise<Map<string, number>> {
  const items = sections.flatMap((s) =>
    s.in_final && !BOILERPLATE.test(s.heading) ? [{ id: s.id, text: `${s.heading}. ${s.preview}` }] : [],
  );

  if (items.length < 4) {
    return new Map();
  }

  const dir = join(paths.raw("analyze"), "offtopic");
  const input = join(dir, `${bill}.in.json`);
  const output = join(dir, `${bill}.json`);
  const key = JSON.stringify(items);
  const prev = Bun.file(input);

  if (!(await prev.exists()) || (await prev.text()) !== key || !(await Bun.file(output).exists())) {
    await Bun.write(input, key);
    await python(PKG, "offtopic.py", [input, output], { memoryMax: "3G" });
  }

  const raw = OffTopicFile.parse(await Bun.file(output).json()).scores;
  const values = Object.values(raw).toSorted((a, b) => a - b);
  const rank = (v: number) => values.filter((x) => x < v).length / Math.max(values.length - 1, 1);

  return new Map(Object.entries(raw).map(([id, v]) => [id, Number(rank(v).toFixed(4))]));
}

async function runParts(ctx: StageContext) {
  const bill = billOf(ctx);
  const sections = await readRows("sections", bill);

  if (!sections.length) {
    throw new Error(`no sections for ${bill}: run the bills stage first`);
  }

  const [b] = await readRows("bills", bill);

  const parts = await sectionParts(sections, await readRows("versions", bill), {
    lateUnavailable: b?.late_unavailable ?? null,
  });

  const rows = partRows(bill, sections, parts);
  await writeRows("section_parts", bill, rows);
  const split = new Set(rows.map((r) => r.section_id)).size;
  const late = rows.filter((r) => r.late);
  const inOld = late.filter((r) => sections.find((s) => s.id === r.section_id)?.late !== true).length;
  ctx.log(
    `${split} long sections read in ${rows.length} parts; ${late.length} parts added late${inOld ? ` (${inOld} written into a section that was there before)` : ""}`,
  );
}

const sentenceLocator = (path: string) =>
  `${path
    .replaceAll("/", ", ")
    .replaceAll(":", " ")
    .replace(/\bsec /u, "sec. ")}, the sentence quoted`;

async function runReach(ctx: StageContext) {
  const bill = billOf(ctx);
  const sections = await readRows("sections", bill);

  if (!sections.length) {
    throw new Error(`no sections for ${bill}: run the bills stage first`);
  }

  const versions = await readRows("versions", bill);
  const texts = await sectionTexts(sections, versions);

  const rows = sections.flatMap((s): Row<"section_reach">[] => {
    const t = texts.get(s.id);

    return t
      ? reach(t.text).map((tag) => ({
          id: `${s.id}#${tag.kind}`,
          bill_id: bill,
          section_id: s.id,
          part_id: null,
          kind: tag.kind,
          pattern: tag.pattern,
          quote: tag.quote,
          version: t.version,
          source_url: t.url,
          source_locator: sentenceLocator(t.path),
        }))
      : [];
  });

  const [b] = await readRows("bills", bill);
  const parts = await sectionParts(sections, versions, { lateUnavailable: b?.late_unavailable ?? null });
  const located = new Map(partRows(bill, sections, parts).map((r) => [r.id, r.source_locator]));

  const partTags = parts.flatMap((p): Row<"section_reach">[] =>
    reach(p.text).map((tag) => ({
      id: `${p.id}#${tag.kind}`,
      bill_id: bill,
      section_id: p.sectionId,
      part_id: p.id,
      kind: tag.kind,
      pattern: tag.pattern,
      quote: tag.quote,
      version: p.version,
      source_url: p.url,
      source_locator: `${located.get(p.id)}, the sentence quoted`,
    })),
  );

  await writeRows("section_reach", bill, [...rows, ...partTags]);
  const missing = sections.length - texts.size;
  const kinds = Object.entries(Object.groupBy(rows, (r) => r.kind)).map(([k, v]) => `${v.length} ${k}`);
  ctx.log(
    `${new Set(rows.map((r) => r.section_id)).size} of ${sections.length} sections have reach${kinds.length ? ` (${kinds.join(", ")})` : ""}${missing ? `; ${missing} sections' text not found` : ""}${
      partTags.length ? `; ${new Set(partTags.map((r) => r.part_id)).size} parts of long sections have their own` : ""
    }`,
  );
}

async function runScores(ctx: StageContext) {
  const bill = billOf(ctx);
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
    await readRows("section_parts", bill),
  );

  await writeRows("section_scores", bill, rows);
  const n = (l: string) => rows.filter((r) => r.label === l).length;
  const cleared = rows.filter((r) => r.late_cleared_by !== null && r.late_cleared_by !== "").length;

  const onReach = rows.filter(
    (r) =>
      r.label === "buried" &&
      stakes({ dollarsMusd: r.dollars_musd, dollarsSplit: r.dollars_split, lobbyingFirms: r.lobbying_firms }) <
        SCORE.costlyMin,
  ).length;

  ctx.log(
    `${rows.filter((r) => !isPartRow(r)).length} final sections and ${rows.filter(isPartRow).length} parts: ${n("headline")} headline, ${n("buried")} buried${onReach ? ` (${onReach} on reach alone)` : ""}${cleared ? `, ${cleared} not late after the counterpart check` : ""}; ` +
      `dollars from ${dollars.estimates.map((e) => e.id).join(" and ") || "no per-section CBO estimate"}`,
  );
}

export const stages: Stage[] = [
  { name: "parts", scope: "bill", needs: ["bills"], writes: ["section_parts"], run: runParts },
  { name: "attention", scope: "bill", needs: ["news", "bills", "parts"], writes: ["attention"], run: runAttention },
  { name: "reach", scope: "bill", needs: ["bills", "parts"], writes: ["section_reach"], run: runReach },
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
    needs: ["attention", "bills", "parts", "cbo", "lobbying", "reach", "quiet-check"],
    writes: ["section_scores"],
    run: runScores,
  },
];
