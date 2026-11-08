import { join } from "node:path";
import { parseJson, filled } from "@antibody/core";
import type { Row, StageContext } from "@antibody/core";
import { paths, readRows, writeRows } from "@antibody/core/node";
import { z } from "zod";
import { localFile } from "./fetch.ts";
import { readGlance } from "./parsed.ts";
import { hasHeading, hasPath } from "./sections.ts";
import { orNull } from "./xray.ts";

export const MODEL = "claude-sonnet-5-5";
const LEGACY_MODEL = "claude-opus-5-5";

export const RULE =
  "cbo-prose-to-section: a model (named in the evidence) linked this sentence of CBO's estimate to the bill section whose provision it describes; the quote is checked word for word against the cited PDF page";

export const MIN_CONFIDENCE = 0.5;

const Link = z.object({
  section: z.union([z.string(), z.number()]).transform(String),
  page: z.number(),
  quote: z.string(),
  why: z.string(),
  confidence: z.number(),
});

export type Link = z.output<typeof Link>;

interface Section {
  num: string;
  heading: string;
  id: string;
}

const Links = z.object({ links: z.array(Link) });

const Answer = Links.extend({ costUsd: z.number(), model: z.string().optional() });

type Answer = z.output<typeof Answer>;

const Reply = z.object({ result: z.string(), total_cost_usd: z.number().optional() });

export function norm(s: string): string {
  return s
    .normalize("NFKC")
    .replaceAll(/[‘’]/gu, "'")
    .replaceAll(/[“”]/gu, '"')
    .replaceAll(/[‐-―−]/gu, "-")
    .replaceAll(/-\s+/gu, "-")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

export function verify(links: Link[], pages: string[], sections: Section[]): (Link & { sectionId: string })[] {
  const byNum = new Map(sections.map((s) => [s.num, s]));
  const pageText = pages.map(norm);
  const seen = new Set<string>();

  return links.flatMap((l) => {
    const s = byNum.get(l.section.replace(/^sec(tion)?\.?\s*/iu, ""));
    const text = pageText[l.page - 1];
    const key = `${s?.id}|${norm(l.quote)}`;

    if (
      !s ||
      !filled(text) ||
      l.confidence < MIN_CONFIDENCE ||
      norm(l.quote).length < 20 ||
      !text.includes(norm(l.quote)) ||
      seen.has(key)
    ) {
      return [];
    }

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

async function ask(text: string, cacheFile: string, refresh: boolean): Promise<Answer> {
  const cache = Bun.file(cacheFile);

  if (!refresh && (await cache.exists())) {
    return Answer.parse(await cache.json());
  }

  const proc = Bun.spawn(["claude", "-p", "--model", "sonnet", "--output-format", "json"], {
    env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "antibody" },
    stdin: new TextEncoder().encode(text),
    stdout: "pipe",
    stderr: "pipe",
  });

  const out = await new Response(proc.stdout).text();

  if ((await proc.exited) !== 0) {
    throw new Error(`claude -p failed: ${await new Response(proc.stderr).text()}`);
  }

  const reply = Reply.parse(JSON.parse(out));

  const result = {
    links: parseJson(reply.result, Links).links,
    costUsd: reply.total_cost_usd ?? 0,
    model: MODEL,
  };

  await Bun.write(cacheFile, JSON.stringify(result));

  return result;
}

function scoredSections(rows: Row<"sections">[], code: string | null): Section[] {
  if (!filled(code)) {
    return [];
  }

  return rows.flatMap((s) => {
    const step = s.history[code];
    const num = hasPath(step) ? step.path.split("/").at(-1)?.replace(/^sec:/u, "") : undefined;

    return filled(num) ? [{ num, heading: hasHeading(step) ? step.heading : s.heading, id: s.id }] : [];
  });
}

export async function notes(ctx: StageContext) {
  const bill = ctx.bill;

  if (bill === null) {
    throw new Error("the cbo-notes stage runs for one bill");
  }

  const [estimates, sections] = await Promise.all([readRows("cbo_estimates", bill), readRows("sections", bill)]);
  const rows: Row<"cbo_notes">[] = [];

  for (const e of estimates) {
    const pdfUrl = e.pdf_url;

    if (e.per_section || !filled(pdfUrl)) {
      continue;
    }

    const scored = scoredSections(sections, e.version_code);

    if (!scored.length) {
      ctx.log(`${e.id}: no sections for version ${e.version_code ?? "?"} yet, skipped`);
      continue;
    }

    const glance = await orNull(readGlance(localFile(pdfUrl)));

    if (!glance) {
      continue;
    }

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

    for (const [i, l] of kept.entries()) {
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
        evidence: {
          model: answer.model ?? LEGACY_MODEL,
          section_num: l.section,
          why: l.why,
          quote_checked_on_page: l.page,
        },
      });
    }
  }

  await writeRows("cbo_notes", bill, rows);
}
