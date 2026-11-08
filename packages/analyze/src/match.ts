import { createHash } from "node:crypto";
import { join } from "node:path";
import { billDisplay, parseJson } from "@antibody/core";
import type { BillId, Row } from "@antibody/core";
import { paths, python } from "@antibody/core/node";
import { z } from "zod";
import { claude, messageOf, pool } from "./llm.ts";

export const MATCHER = "section-matcher-v7";
export const MATCH_MODEL = process.env.ANTIBODY_MATCH_MODEL ?? "sonnet";
const BATCH = 8;
const PARALLEL = 4;
const ARTICLE_WORDS = 900;

export interface ArticleIn {
  id: string;
  outlet: string;
  title: string;
  text: string | null;
}

const About = z.enum(["bill", "mention", "unrelated"]);

const MatchSchema = z.object({
  about: About,
  sections: z.array(z.string()),
  whole: z.boolean(),
  outside: z.string().nullable(),
});

export type Match = z.infer<typeof MatchSchema>;

const MatchRunSchema = z.object({
  matcher: z.string(),
  model: z.string(),
  menuHash: z.string(),
  costUsd: z.number(),
  matches: z.record(z.string(), MatchSchema),
});

export type MatchRun = z.infer<typeof MatchRunSchema>;

const CandidatesFile = z.object({ candidates: z.record(z.string(), z.array(z.string())) });

const EmbedFile = z.object({ model: z.string(), matches: z.record(z.string(), MatchSchema) });

const Verdicts = z.array(
  z.object({
    a: z.unknown().transform(Number),
    about: About.catch("unrelated"),
    s: z.array(z.string().nullable().catch(null)),
    whole: z.unknown().transform(Boolean),
    outside: z.string().nullish(),
  }),
);

const lead = (s: string, words: number) => s.split(/\s+/u).slice(0, words).join(" ");

const GENERIC =
  /^(?:in general|definitions?|exceptions?|exclusions?|inclusions?|applicability|prohibition|effective date|rule of construction|limitation|authority|conforming amendments?|sense of congress|purpose|findings|report|other|requirements?)$/iu;

export function subjectOf(text: string, max = 8): string {
  const found: string[] = [];

  const add = (t: string | undefined) => {
    const v = t?.replaceAll(/\s+/gu, " ").trim();

    if (v !== undefined && v !== "" && !GENERIC.test(v) && !found.some((f) => f.toLowerCase() === v.toLowerCase())) {
      found.push(v);
    }
  };

  for (const m of text.matchAll(/term ['‘’"“”]\s*([^'‘’"“”]{2,40}?)\s*['‘’"“”] means/gu)) {
    add(m[1]);
  }

  for (const m of text.matchAll(/entitled ['‘’"“”]+\s*([^'‘’"“”]{5,160}?)\s*['‘’"“”]/gu)) {
    add(m[1]);
  }

  for (const m of text.matchAll(/(?:^|\)\s|\.\s|-\s)([A-Z][A-Za-z'’ ,-]{2,40}?) \.-/gu)) {
    add(m[1]);
  }

  for (const m of text.matchAll(
    /\b((?:[A-Z][a-zA-Z]+ )(?:(?:[A-Z][a-zA-Z]+|of|and|the|for|on|to) ){0,6}Act(?: of \d{4})?)\b/gu,
  )) {
    add(m[1]);
  }

  return found.slice(0, max).join("; ");
}

const line = (s: Row<"sections">, key: string) =>
  `${key} | sec. ${s.num} | ${s.heading}${s.in_final ? "" : " [dropped before the final text]"} | ${lead(s.preview, 30)}`;

export function menu(sections: Row<"sections">[]) {
  const ids = new Map<string, string>();

  const lines = sections.map((s, i) => {
    const key = `S${i + 1}`;
    ids.set(key, s.id);

    return line(s, key);
  });

  return { text: lines.join("\n"), ids };
}

export const SHORTLIST = 15;
export const LEXICAL = 12;
export const WHOLE_MENU = 40;

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

  const r = CandidatesFile.parse(await Bun.file(output).json());

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
  `ARTICLE ${n}\nTitle: ${a.title}\n${a.text === null || a.text === "" ? "(only the headline could be read)" : lead(a.text, ARTICLE_WORDS)}`;

export function withParts(sections: Row<"sections">[], parts: (Row<"sections"> & { parent: string })[]) {
  const of = Map.groupBy(parts, (p) => p.parent);

  return sections.flatMap((s) => [s, ...(of.get(s.id) ?? [])]);
}

export async function matchArticles(
  bill: BillId,
  title: string,
  sectionsOnly: Row<"sections">[],
  articles: ArticleIn[],
  opts: {
    names?: string[];
    refresh?: boolean;
    model?: string;
    log?: (m: string) => void;
    signal?: AbortSignal;
    parts?: (Row<"sections"> & { parent: string })[];
  } = {},
): Promise<MatchRun> {
  const model = opts.model ?? MATCH_MODEL;
  const parts = opts.parts ?? [];
  const sections = withParts(sectionsOnly, parts);
  const parentOf = new Map(parts.map((p) => [p.id, p.parent]));
  const byId = new Map(sections.map((x) => [x.id, x]));
  const whole = sectionsOnly.length <= WHOLE_MENU;

  const menuHash = createHash("sha1")
    .update(`${whole ? 0 : `${SHORTLIST}+${LEXICAL}`}\n${menu(sections).text}`)
    .digest("hex")
    .slice(0, 12);

  const file = Bun.file(join(paths.raw("analyze"), "match", `${bill}.${model}.json`));
  const prior = (await file.exists()) ? MatchRunSchema.safeParse(await file.json()).data : undefined;

  const reuse =
    prior !== undefined && opts.refresh !== true && prior.matcher === MATCHER && prior.menuHash === menuHash;

  const run: MatchRun = reuse ? prior : { matcher: MATCHER, model, menuHash, costUsd: 0, matches: {} };

  const todo = articles.filter((a) => run.matches[a.id] === undefined);
  const batches: ArticleIn[][] = [];

  for (let i = 0; i < todo.length; i += BATCH) {
    batches.push(todo.slice(i, i + BATCH));
  }

  if (batches.length) {
    opts.log?.(`matching ${todo.length} articles in ${batches.length} calls (${model})`);
  }

  const sys = system(bill, title);
  const everything = whole;

  const short =
    todo.length > 0 && !everything
      ? await shortlist(bill, opts.names ?? [], sections, todo)
      : new Map<string, string[]>();

  await pool(batches, PARALLEL, async (batch, bi) => {
    const menus: Map<string, string>[] = [];

    const prompt = batch
      .map((a, i) => {
        const m = menu(
          everything
            ? sections
            : withSections(short.get(a.id) ?? [], parentOf).flatMap((id) => {
                const s = byId.get(id);

                return s === undefined ? [] : [s];
              }),
        );

        menus.push(m.ids);

        return `${articleBlock(a, i + 1)}\n\nSECTIONS THIS ARTICLE MIGHT BE ABOUT\n${m.text}`;
      })
      .join("\n\n=====\n\n");

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const r = await claude(prompt, { system: sys, model, signal: opts.signal });
        let out: z.infer<typeof Verdicts>;

        try {
          out = parseJson(r.text, Verdicts);
        } catch (error) {
          const kept = `${file.name}.unreadable-${bi + 1}.txt`;
          await Bun.write(kept, r.text);
          throw new Error(`${messageOf(error)} (reply kept in ${kept})`, { cause: error });
        }

        for (const o of out) {
          const a = batch[o.a - 1];
          const ids = menus[o.a - 1];

          if (a === undefined || ids === undefined) {
            continue;
          }

          run.matches[a.id] = {
            about: o.about,
            sections: [
              ...new Set(
                o.s.flatMap((k) => {
                  const id = k === null ? undefined : ids.get(k);

                  return id === undefined ? [] : [id];
                }),
              ),
            ],
            whole: o.whole,
            outside: (o.outside ?? "").trim() || null,
          };
        }

        run.model = r.model;
        run.costUsd += r.costUsd;

        if (batch.every((a) => run.matches[a.id] !== undefined)) {
          break;
        }
      } catch (error) {
        opts.log?.(`batch ${bi + 1}: ${messageOf(error).slice(0, 160)}`);
      }
    }

    await Bun.write(file, JSON.stringify(run));
  });
  await Bun.write(file, JSON.stringify(run));
  const missing = articles.filter((a) => run.matches[a.id] === undefined).length;

  if (missing) {
    throw new Error(`${missing} of ${articles.length} articles could not be matched; re-run to finish`);
  }

  return run;
}

function withSections(ids: string[], parentOf: Map<string, string>): string[] {
  const out: string[] = [];

  for (const id of ids) {
    const parent = parentOf.get(id);

    if (parent !== undefined && parent !== "" && !out.includes(parent)) {
      out.push(parent);
    }

    if (!out.includes(id)) {
      out.push(id);
    }
  }

  return out;
}

export const EMBED_MATCHER = "section-matcher-embed-v1";

export async function cachedMatchRun(bill: BillId, model = MATCH_MODEL): Promise<MatchRun | null> {
  const dir = join(paths.raw("analyze"), "match");
  const claudeRun = Bun.file(join(dir, `${bill}.${model}.json`));

  if (await claudeRun.exists()) {
    const r = MatchRunSchema.safeParse(await claudeRun.json());

    if (r.data?.matcher === MATCHER) {
      return r.data;
    }
  }

  const embed = Bun.file(join(dir, `${bill}.embed.json`));

  if (!(await embed.exists())) {
    return null;
  }

  const r = EmbedFile.parse(await embed.json());

  return { matcher: EMBED_MATCHER, model: r.model, menuHash: "", costUsd: 0, matches: r.matches };
}

export async function claudeAvailable(model = MATCH_MODEL): Promise<boolean> {
  try {
    await claude('Reply with {"ok":true}', { system: "Reply with JSON only.", model });

    return true;
  } catch {
    return false;
  }
}

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

  const r = EmbedFile.parse(await Bun.file(output).json());

  return { matcher: EMBED_MATCHER, model: r.model, menuHash: "", costUsd: 0, matches: r.matches };
}
