import { createHash } from "node:crypto";
import { join } from "node:path";
import { type BillId, billDisplay, type Row } from "@antibody/core";
import { paths, python } from "@antibody/core/node";
import { claude, parseJson, pool } from "./llm.ts";

/** Bumped whenever the prompt or the menu format changes; old matches are then re-done. */
export const MATCHER = "section-matcher-v7";
export const MATCH_MODEL = process.env.ANTIBODY_MATCH_MODEL ?? "sonnet";
const BATCH = 8;
const PARALLEL = 4;
const ARTICLE_WORDS = 900;

export interface ArticleIn {
  id: string;
  /** Not shown to the matcher: it judges the text, never who published it. */
  outlet: string;
  title: string;
  text: string | null;
}

export interface Match {
  /** bill: the bill, its provisions or the fight over it is a main subject; mention: it comes up in passing. */
  about: "bill" | "mention" | "unrelated";
  sections: string[];
  whole: boolean;
  outside: string | null;
}

export interface MatchRun {
  matcher: string;
  model: string;
  menuHash: string;
  costUsd: number;
  matches: Record<string, Match>;
}

const lead = (s: string, words: number) => s.split(/\s+/).slice(0, words).join(" ");

const line = (s: Row<"sections">, key: string) =>
  `${key} | sec. ${s.num} | ${s.heading}${s.in_final ? "" : " [dropped before the final text]"} | ${lead(s.preview, 30)}`;

/** A menu of the given sections: "S1 | sec. 70301 | heading | first words" lines, and the key → section id map. */
export function menu(sections: Row<"sections">[]) {
  const ids = new Map<string, string>();
  const lines = sections.map((s, i) => {
    const key = `S${i + 1}`;
    ids.set(key, s.id);
    return line(s, key);
  });
  return { text: lines.join("\n"), ids };
}

/** Sections shown per article. A short bill is shown whole. */
export const SHORTLIST = 15;
/** Extra sections per article added by word overlap with the section heading (py/candidates.py). */
export const LEXICAL = 12;
/** A bill with this many sections or fewer is shown whole to the matcher: no shortlist step. */
export const WHOLE_MENU = 40;

/**
 * The sections each article might be about (py/candidates.py: best embedding match between the section's heading and
 * opening words and any paragraph of the article). Cached per bill.
 */
export async function shortlist(
  bill: BillId,
  names: string[],
  sections: Row<"sections">[],
  articles: ArticleIn[],
): Promise<Map<string, string[]>> {
  const dir = join(paths.raw("analyze"), "match");
  const input = join(dir, `${bill}.cand.in.json`);
  const output = join(dir, `${bill}.cand.json`);
  const payload = JSON.stringify({
    shortlist: MATCHER,
    k: SHORTLIST,
    names,
    sections: sections.map((s) => ({ id: s.id, text: `${s.heading}. ${lead(s.preview, 30)}` })),
    articles: articles.map((a) => ({ id: a.id, title: a.title, text: a.text?.slice(0, 14_000) ?? "" })),
  });
  const prev = Bun.file(input);
  if (!(await prev.exists()) || (await prev.text()) !== payload || !(await Bun.file(output).exists())) {
    await Bun.write(input, payload);
    await python(join(import.meta.dir, ".."), "candidates.py", [input, output], { memoryMax: "3G" });
  }
  const r: { candidates: Record<string, string[]> } = await Bun.file(output).json();
  return new Map(Object.entries(r.candidates));
}

function system(bill: BillId, title: string) {
  return `You read news articles about the US bill ${billDisplay(bill)} ("${title}") and record which of its sections each article discusses.

Each article comes with a short list of the bill's sections it might be about, as: id | section number | heading | first words of its text. Pick only from that list, and pick every section on it the article discusses. Sections marked [dropped before the final text] were in an earlier version only.

For each article:
- "about": "bill" when the bill, its provisions or the fight over it is a main subject of the article; "mention" when the bill comes up in an article mainly about something else; "unrelated" when it is not about this bill at all (another bill, or a passing word).
- "s": the ids of every section whose subject the article discusses: what the provision does, who it affects, what it costs, or the fight over it. The article does not need to cite the section number ("no tax on tips" is the tips section). A short mention in a list of provisions counts. Leave out sections the article does not touch. When several sections share one subject, list the ones the article's details point to.
- "whole": true when the article covers the bill as a whole (its passage, a vote, its politics, its total cost), whether or not it also discusses sections.
- "outside": when the article is about this bill's debate but its main subject is something that is not in the bill's text (an issue the bill leaves out, a failed amendment, a conflict of interest tied to it), name that subject in at most eight plain, neutral words; otherwise null.

Judge every article by the same standard, whatever its point of view. Reply with JSON only: an array with one object per article, {"a": <article number>, "about": "bill"|"mention"|"unrelated", "s": [...], "whole": true|false, "outside": string|null}.`;
}

const articleBlock = (a: ArticleIn, n: number) =>
  `ARTICLE ${n}\nTitle: ${a.title}\n${a.text ? lead(a.text, ARTICLE_WORDS) : "(only the headline could be read)"}`;

export async function matchArticles(
  bill: BillId,
  title: string,
  sections: Row<"sections">[],
  articles: ArticleIn[],
  opts: { names?: string[]; refresh?: boolean; model?: string; log?: (m: string) => void; signal?: AbortSignal } = {},
): Promise<MatchRun> {
  const model = opts.model ?? MATCH_MODEL;
  const byId = new Map(sections.map((x) => [x.id, x]));
  const menuHash = createHash("sha1")
    .update(`${sections.length <= WHOLE_MENU ? 0 : `${SHORTLIST}+${LEXICAL}`}\n${menu(sections).text}`)
    .digest("hex")
    .slice(0, 12);
  const file = Bun.file(join(paths.raw("analyze"), "match", `${bill}.${model}.json`));
  const prior: MatchRun | null = (await file.exists()) ? await file.json() : null;
  const reuse = prior && !opts.refresh && prior.matcher === MATCHER && prior.menuHash === menuHash;
  const run: MatchRun = reuse ? prior : { matcher: MATCHER, model, menuHash, costUsd: 0, matches: {} };

  const todo = articles.filter((a) => !run.matches[a.id]);
  const batches: ArticleIn[][] = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
  if (batches.length) opts.log?.(`matching ${todo.length} articles in ${batches.length} calls (${model})`);
  const sys = system(bill, title);
  const everything = sections.length <= WHOLE_MENU;
  const short =
    todo.length && !everything ? await shortlist(bill, opts.names ?? [], sections, todo) : new Map<string, string[]>();

  await pool(batches, PARALLEL, async (batch, bi) => {
    const menus: Map<string, string>[] = [];
    const prompt = batch
      .map((a, i) => {
        const m = menu(
          everything ? sections : (short.get(a.id) ?? []).flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
        );
        menus.push(m.ids);
        return `${articleBlock(a, i + 1)}\n\nSECTIONS THIS ARTICLE MIGHT BE ABOUT\n${m.text}`;
      })
      .join("\n\n=====\n\n");
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const r = await claude(prompt, { system: sys, model, signal: opts.signal });
        const out = parseJson<
          { a: number; about: Match["about"]; s: string[]; whole: boolean; outside: string | null }[]
        >(r.text);
        for (const o of out) {
          const a = batch[o.a - 1];
          const ids = menus[o.a - 1];
          if (!a || !ids) continue;
          run.matches[a.id] = {
            about: ["bill", "mention", "unrelated"].includes(o.about) ? o.about : "unrelated",
            sections: [...new Set(o.s.flatMap((k) => (ids.has(k) ? [ids.get(k)!] : [])))],
            whole: !!o.whole,
            outside: o.outside?.trim() || null,
          };
        }
        run.model = r.model;
        run.costUsd += r.costUsd;
        if (batch.every((a) => run.matches[a.id])) break;
      } catch (e) {
        opts.log?.(`batch ${bi + 1}: ${(e as Error).message.slice(0, 160)}`);
      }
    }
    await Bun.write(file, JSON.stringify(run));
  });
  await Bun.write(file, JSON.stringify(run));
  const missing = articles.filter((a) => !run.matches[a.id]).length;
  if (missing) throw new Error(`${missing} of ${articles.length} articles could not be matched; re-run to finish`);
  return run;
}

export const EMBED_MATCHER = "section-matcher-embed-v1";

/** True when a tiny claude -p call goes through (no spend limit, logged in). */
export async function claudeAvailable(model = MATCH_MODEL): Promise<boolean> {
  try {
    await claude('Reply with {"ok":true}', { system: "Reply with JSON only.", model });
    return true;
  } catch {
    return false;
  }
}

/**
 * The fallback matcher: local embeddings (py/match_embed.py), no model calls. Weaker than the claude matcher (it
 * can't tell a passing mention from a main subject, and has no outside-the-text lane), so a bill is matched by one
 * or the other, never a mix, and the attention rows say which.
 */
export async function matchEmbed(
  bill: BillId,
  title: string,
  names: string[],
  sections: Row<"sections">[],
  articles: ArticleIn[],
): Promise<MatchRun> {
  const dir = join(paths.raw("analyze"), "match");
  const input = join(dir, `${bill}.embed.in.json`);
  const output = join(dir, `${bill}.embed.json`);
  const payload = {
    bill_title: title,
    names,
    sections: sections.map((s) => ({ id: s.id, text: `${s.heading}. ${lead(s.preview, 30)}` })),
    articles: articles.map((a) => ({ id: a.id, title: a.title, text: a.text?.slice(0, 14_000) ?? "" })),
  };
  const key = JSON.stringify(payload);
  const prev = Bun.file(input);
  if (!(await prev.exists()) || (await prev.text()) !== key || !(await Bun.file(output).exists())) {
    await Bun.write(input, key);
    await python(join(import.meta.dir, ".."), "match_embed.py", [input, output], { memoryMax: "3G" });
  }
  const r = await Bun.file(output).json();
  return { matcher: EMBED_MATCHER, model: r.model, menuHash: "", costUsd: 0, matches: r.matches };
}
