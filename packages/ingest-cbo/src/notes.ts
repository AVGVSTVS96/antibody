import { join } from "node:path";
import type { Row, StageContext } from "@antibody/core";
import { paths, readRows, writeRows } from "@antibody/core/node";
import { localFile } from "./fetch.ts";
import { parse } from "./xray.ts";

export const MODEL = "claude-opus-5-5";
export const RULE =
  "cbo-prose-to-section: a model (Opus 5.5) linked this sentence of CBO's estimate to the bill section whose provision it describes; the quote is checked word for word against the cited PDF page";

/** Below this the model itself is unsure the sentence is about that section; such links are dropped, not shown. */
export const MIN_CONFIDENCE = 0.5;

export interface Link {
  section: string;
  page: number;
  quote: string;
  why: string;
  confidence: number;
}

interface Section {
  num: string;
  heading: string;
  id: string;
}

/** Folds the differences between a model's copy and pdfplumber's text: whitespace, curly quotes, dashes, ligatures. */
export function norm(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/-\s+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Keeps a link only when its section exists in the scored version, its quote is on the page it names, and the model is fairly sure. */
export function verify(links: Link[], pages: string[], sections: Section[]): (Link & { sectionId: string })[] {
  const byNum = new Map(sections.map((s) => [s.num, s]));
  const pageText = pages.map(norm);
  const seen = new Set<string>();
  return links.flatMap((l) => {
    const s = byNum.get(String(l.section).replace(/^sec(tion)?\.?\s*/i, ""));
    const text = pageText[l.page - 1];
    const key = `${s?.id}|${norm(l.quote)}`;
    if (
      !s ||
      !text ||
      l.confidence < MIN_CONFIDENCE ||
      norm(l.quote).length < 20 ||
      !text.includes(norm(l.quote)) ||
      seen.has(key)
    )
      return [];
    seen.add(key);
    return [{ ...l, section: s.num, sectionId: s.id }];
  });
}

function prompt(pages: string[], sections: Section[]): string {
  return `Below is the text of a Congressional Budget Office cost estimate, page by page, and the sections of the bill text it scored.

For each sentence in which CBO describes the cost, savings, revenue, or mandate effect of a specific provision, link it to the bill section that provision is in. Skip boilerplate (CBO's standard explanations, staff names, the At a Glance box) and sentences about the bill as a whole. A sentence may link to more than one section; give one entry per section.

Answer with JSON only, no prose and no code fence:
{"links":[{"section":"<section number exactly as listed>","page":<page number>,"quote":"<the sentence, copied exactly from that page>","why":"<under 20 words: which provision and why it is this section>","confidence":<0 to 1>}]}

BILL SECTIONS
${sections.map((s) => `${s.num}. ${s.heading}`).join("\n")}

CBO ESTIMATE
${pages.map((p, i) => `=== page ${i + 1} ===\n${p}`).join("\n\n")}`;
}

async function ask(text: string, cacheFile: string, refresh: boolean): Promise<{ links: Link[]; costUsd: number }> {
  const cache = Bun.file(cacheFile);
  if (!refresh && (await cache.exists())) return cache.json();
  const proc = Bun.spawn(["claude", "-p", "--model", MODEL, "--output-format", "json"], {
    stdin: new TextEncoder().encode(text),
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error(`claude -p failed: ${await new Response(proc.stderr).text()}`);
  const reply = JSON.parse(out) as { result: string; total_cost_usd?: number };
  const body = reply.result.slice(reply.result.indexOf("{"), reply.result.lastIndexOf("}") + 1);
  const result = { links: (JSON.parse(body) as { links: Link[] }).links, costUsd: reply.total_cost_usd ?? 0 };
  await Bun.write(cacheFile, JSON.stringify(result));
  return result;
}

function scoredSections(rows: Row<"sections">[], code: string | null): Section[] {
  if (!code) return [];
  return rows.flatMap((s) => {
    const step = s.history[code] as { path?: string; heading?: string } | undefined;
    const num = step?.path?.split("/").at(-1)?.replace(/^sec:/, "");
    return num ? [{ num, heading: step?.heading ?? s.heading, id: s.id }] : [];
  });
}

/**
 * Small bills get whole-bill numbers only. Where CBO's prose names what drives them ("administrative costs for
 * federal financial agencies"), a model links the sentence to a section; each link is a labeled inference.
 */
export async function notes(ctx: StageContext) {
  const bill = ctx.bill!;
  const [estimates, sections] = await Promise.all([readRows("cbo_estimates", bill), readRows("sections", bill)]);
  const rows: Row<"cbo_notes">[] = [];
  for (const e of estimates.filter((e) => !e.per_section && e.pdf_url)) {
    const scored = scoredSections(sections, e.version_code);
    if (!scored.length) {
      ctx.log(`${e.id}: no sections for version ${e.version_code ?? "?"} yet, skipped`);
      continue;
    }
    const glance = await parse<{ pages: string[] }>("glance", localFile(e.pdf_url!));
    if (!glance) continue;
    const t0 = performance.now();
    const answer = await ask(
      prompt(glance.pages, scored),
      join(paths.raw("cbo"), "notes", `${e.id}.json`),
      ctx.refresh,
    );
    const kept = verify(answer.links, glance.pages, scored);
    ctx.log(
      `${e.id}: ${answer.links.length} links proposed, ${kept.length} kept (quote on its page, section exists, model confidence ≥ 0.5) · $${answer.costUsd.toFixed(2)} · ${((performance.now() - t0) / 1000).toFixed(0)}s`,
    );
    for (const [i, l] of kept.entries())
      rows.push({
        id: `${e.id}:n${i + 1}`,
        estimate_id: e.id,
        bill_id: bill,
        section_id: l.sectionId,
        quote: l.quote,
        page: l.page,
        rule: RULE,
        confidence: Math.min(Math.max(l.confidence, 0), 0.9),
        rests_on: [`cbo_estimates/${e.id}`, `sections/${l.sectionId}`],
        evidence: { model: MODEL, section_num: l.section, why: l.why, quote_checked_on_page: l.page },
      });
  }
  await writeRows("cbo_notes", bill, rows);
}
