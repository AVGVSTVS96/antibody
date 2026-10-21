import { createHash } from "node:crypto";
import { join } from "node:path";
import { type BillId, billDisplay, type Row } from "@antibody/core";
import { paths, python } from "@antibody/core/node";
import { claude, parseJson, pool } from "./llm.ts";
import { type ArticleIn, MATCH_MODEL } from "./match.ts";

export const RECHECK = "quiet-check-v1";
/** Bumped when the judge's question changes, so earlier answers are asked again. */
const JUDGE = "quote-v1";
/** Bumped when the description prompt or the passage finder changes. */
const FINDER = "phrases-v4";

export const CHECK_RULE =
  "quiet-check-v1: a section that looks quiet with big stakes gets a second look before it is called quiet. A language " +
  "model restates the provision in everyday news words; the 8 passages from the articles read that use those words " +
  "or are closest in meaning (one per article) go back to the model, which says which of them describe what the " +
  "provision does. Articles it names add to the section's attention.";

/** News passages put to the model per section. */
export const PASSAGES = 8;
const BATCH = 6;
const PARALLEL = 4;
const SECTION_WORDS = 60;

export interface Checked {
  key: string;
  /** The articles whose passage was put to the model, with the passage's similarity to the section. */
  passages: { article: string; sim: number }[];
  /** The articles whose passage the model said describes the provision. */
  yes: string[];
}

/** How a provision would be put in a news article: a plain sentence and phrases an article about it might use. */
export interface Described {
  key: string;
  says: string;
  phrases: string[];
}

export interface CheckRun {
  checker: string;
  model: string;
  costUsd: number;
  described: Record<string, Described>;
  results: Record<string, Checked>;
}

interface Passage {
  article: string;
  sim: number;
  text: string;
}

const lead = (s: string, words: number) => s.split(/\s+/).slice(0, words).join(" ");
const sectionText = (s: Row<"sections">) => `${s.heading}. ${lead(s.preview, SECTION_WORDS)}`;
/** Lowercase words only, so a quote matches its passage whatever the punctuation or spacing. */
const words = (s: string) =>
  ` ${s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

function system(bill: BillId, title: string) {
  return `You check whether news articles discuss a specific provision of the US bill ${billDisplay(bill)} ("${title}").

For each provision you get its section number, its heading and the first words of its legal text, then numbered passages from different news articles. A passage discusses the provision when it says what the provision does, who it affects, what it costs, or the fight over it. The passage does not need to cite the section number or use the bill's legal wording: a passage about "a $2,000 annual cap on out-of-pocket drug costs" discusses the section that redesigns Medicare Part D. A passage about the same subject area that does not describe this provision's content (it covers drug pricing in general, but not the rebate rule) does not count, and neither does one that only names the bill.

Judge every passage by the same standard, whatever its point of view. For each passage that does discuss the provision, quote the words of the passage that show it (at most 15 words, copied exactly). Reply with JSON only: an array with one object per provision, {"p": <provision number>, "yes": [{"n": <passage number>, "quote": "<words from the passage>"}]}.`;
}

function describeSystem(bill: BillId, title: string) {
  return `You help find news coverage of provisions of the US bill ${billDisplay(bill)} ("${title}"). For each provision you get its section number, heading and the first words of its legal text.

For each one write "says": one plain sentence on what the provision does, in the everyday words and numbers a news article would use rather than the legal wording, and "phrases": 8 short phrases (one to four words each, lowercase, the plainest first) that an article about the provision would be likely to contain, such as the common name of a program, tax or rule ("child care" before "child care stabilization grants"), the figure that matters, and the group it affects. Use only what the provision's own text and heading support.

Reply with JSON only: an array with one object per provision, {"p": <provision number>, "says": "...", "phrases": ["...", ...]}.`;
}

/** The passages each section is closest to (py/recheck.py), cached per bill. */
async function passages(
  bill: BillId,
  names: string[],
  sections: Row<"sections">[],
  described: Record<string, Described>,
  articles: ArticleIn[],
  pkg: string,
): Promise<Map<string, Passage[]>> {
  const dir = join(paths.raw("analyze"), "recheck");
  const input = join(dir, `${bill}.passages.in.json`);
  const output = join(dir, `${bill}.passages.json`);
  const payload = JSON.stringify({
    recheck: RECHECK,
    finder: FINDER,
    k: PASSAGES,
    names,
    sections: sections.map((s) => ({
      id: s.id,
      text: `${s.heading}. ${described[s.id]?.says ?? lead(s.preview, SECTION_WORDS)}`,
      phrases: described[s.id]?.phrases ?? [],
    })),
    articles: articles.map((a) => ({ id: a.id, title: a.title, text: a.text?.slice(0, 14_000) ?? "" })),
  });
  const prev = Bun.file(input);
  if (!(await prev.exists()) || (await prev.text()) !== payload || !(await Bun.file(output).exists())) {
    await Bun.write(input, payload);
    await python(pkg, "recheck.py", [input, output], { memoryMax: "3G" });
  }
  const r: { passages: Record<string, Passage[]> } = await Bun.file(output).json();
  return new Map(Object.entries(r.passages));
}

/**
 * Asks a model which news passages describe each candidate section. `articles` are the relevant articles from counted
 * outlets; a section's passages are the closest in meaning, one per article. Cached per bill and model by what the
 * model was shown, so a re-run only asks about sections whose passages changed.
 */
export async function recheck(
  bill: BillId,
  title: string,
  names: string[],
  candidates: Row<"sections">[],
  articles: ArticleIn[],
  opts: { pkg: string; refresh?: boolean; model?: string; log?: (m: string) => void; signal?: AbortSignal },
): Promise<CheckRun> {
  const model = opts.model ?? MATCH_MODEL;
  const file = Bun.file(join(paths.raw("analyze"), "recheck", `${bill}.${model}.json`));
  const prior: CheckRun | null = (await file.exists()) ? await file.json() : null;
  const reuse = prior && !opts.refresh && prior.checker === RECHECK;
  const run: CheckRun = reuse ? prior : { checker: RECHECK, model, costUsd: 0, described: {}, results: {} };
  if (!candidates.length) return run;
  run.described ??= {};

  const toDescribe = candidates.filter((s) => run.described[s.id]?.key !== hash(`${FINDER}\n${sectionText(s)}`));
  if (toDescribe.length) opts.log?.(`restating ${toDescribe.length} provisions in news words`);
  const dsys = describeSystem(bill, title);
  const dbatches: Row<"sections">[][] = [];
  for (let i = 0; i < toDescribe.length; i += BATCH) dbatches.push(toDescribe.slice(i, i + BATCH));
  await pool(dbatches, PARALLEL, async (batch, bi) => {
    const prompt = batch.map((s, i) => `PROVISION ${i + 1}\nSection ${s.num} | ${sectionText(s)}`).join("\n\n");
    for (
      let attempt = 0;
      attempt < 5 && !batch.every((s) => run.described[s.id]?.key === hash(`${FINDER}\n${sectionText(s)}`));
      attempt++
    ) {
      try {
        const r = await claude(prompt, { system: dsys, model, signal: opts.signal });
        for (const o of parseJson<{ p: number; says: string; phrases: string[] }[]>(r.text)) {
          const s = batch[o.p - 1];
          if (!s || typeof o.says !== "string") continue;
          const phrases = (Array.isArray(o.phrases) ? o.phrases : [])
            .filter((p): p is string => typeof p === "string")
            .map((p) => p.toLowerCase().trim())
            .filter((p) => p.length >= 4);
          run.described[s.id] = { key: hash(`${FINDER}\n${sectionText(s)}`), says: o.says.trim(), phrases };
        }
        run.model = r.model;
        run.costUsd += r.costUsd;
      } catch (e) {
        opts.log?.(`describe batch ${bi + 1}: ${(e as Error).message.slice(0, 160)}`);
      }
    }
  });
  const undescribed = candidates.filter(
    (s) => run.described[s.id]?.key !== hash(`${FINDER}\n${sectionText(s)}`),
  ).length;
  if (undescribed)
    throw new Error(`${undescribed} of ${candidates.length} sections could not be described; re-run to finish`);
  await Bun.write(file, JSON.stringify(run));

  const close = await passages(bill, names, candidates, run.described, articles, opts.pkg);
  const keyOf = (s: Row<"sections">) =>
    hash(`${JUDGE}\n${sectionText(s)}\n${(close.get(s.id) ?? []).map((p) => p.article).join(",")}`);
  const todo = candidates.filter((s) => run.results[s.id]?.key !== keyOf(s));
  const batches: Row<"sections">[][] = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
  if (batches.length)
    opts.log?.(`checking ${todo.length} sections against their closest passages in ${batches.length} calls (${model})`);
  const sys = system(bill, title);

  await pool(batches, PARALLEL, async (batch, bi) => {
    const prompt = batch
      .map((s, i) => {
        const ps = close.get(s.id) ?? [];
        const body = ps.map((p, j) => `${j + 1}. ${p.text}`).join("\n");
        return `PROVISION ${i + 1}\nSection ${s.num} | ${sectionText(s)}\nIn plain words: ${run.described[s.id]?.says ?? ""}\nPASSAGES\n${body}`;
      })
      .join("\n\n=====\n\n");
    const answered = new Set<string>();
    for (let attempt = 0; attempt < 5 && answered.size < batch.length; attempt++) {
      try {
        const r = await claude(prompt, { system: sys, model, signal: opts.signal });
        const out = parseJson<{ p: number; yes: { n: number | string; quote: string }[] }[]>(r.text);
        for (const o of out) {
          const s = batch[o.p - 1];
          if (!s) continue;
          const ps = close.get(s.id) ?? [];
          const yes = o.yes.flatMap((y) => {
            const p = ps[Number(y.n) - 1];
            return p && typeof y.quote === "string" && words(p.text).includes(words(y.quote)) ? [p.article] : [];
          });
          run.results[s.id] = {
            key: keyOf(s),
            passages: ps.map((p) => ({ article: p.article, sim: p.sim })),
            yes: [...new Set(yes)],
          };
          answered.add(s.id);
        }
        run.model = r.model;
        run.costUsd += r.costUsd;
      } catch (e) {
        opts.log?.(`batch ${bi + 1}: ${(e as Error).message.slice(0, 160)}`);
      }
    }
    await Bun.write(file, JSON.stringify(run));
  });
  await Bun.write(file, JSON.stringify(run));
  const missing = candidates.filter((s) => run.results[s.id]?.key !== keyOf(s)).length;
  if (missing) throw new Error(`${missing} of ${candidates.length} sections could not be checked; re-run to finish`);
  return run;
}
