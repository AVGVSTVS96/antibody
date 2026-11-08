import { BILL_TYPES, billRef } from "@antibody/core";
import type { BillId, BillType } from "@antibody/core";
import { z } from "zod";

export type Level = "high" | "medium" | "low";

const BillIdJson = z.templateLiteral([z.number(), "-", z.enum(BILL_TYPES), "-", z.number()]);

export const Aliases = z.object({
  bill: BillIdJson,
  congress: z.number(),
  numbers: z.array(z.object({ id: BillIdJson, introduced: z.string().nullable(), why: z.string() })),
  names: z.array(
    z.object({
      text: z.string(),
      title: z.string(),
      level: z.enum(["high", "medium"]),
      since: z.string().nullable(),
      why: z.string(),
    }),
  ),
  laws: z.array(z.string()),
  introduced: z.string().nullable(),
  enactedOn: z.string().nullable(),
  rivals: z.array(z.string()),
  support: z.array(z.string()),
  years: z.array(z.number()),
});

export type Aliases = z.infer<typeof Aliases>;

export interface Ref {
  how: "number" | "name" | "public-law";
  text: string;
  level: Level;
  why: string;
}

export interface Period {
  year: number;
  start: string;
  end: string;
}

const PERIODS = new Map<string, [string, string]>([
  ["first_quarter", ["01-01", "03-31"]],
  ["second_quarter", ["04-01", "06-30"]],
  ["third_quarter", ["07-01", "09-30"]],
  ["fourth_quarter", ["10-01", "12-31"]],
  ["mid_year", ["01-01", "06-30"]],
  ["year_end", ["07-01", "12-31"]],
]);

export function period(year: number, code: string): Period {
  const [start, end] = PERIODS.get(code) ?? ["01-01", "12-31"];

  return { year, start: `${year}-${start}`, end: `${year}-${end}` };
}

export const congressOf = (year: number) => Math.floor((year - 1789) / 2) + 1;

const TYPE = String.raw`(H\.?\s?J\.?\s?Res|S\.?\s?J\.?\s?Res|H\.?\s?Con\.?\s?Res|S\.?\s?Con\.?\s?Res|H\.?\s?Res|S\.?\s?Res|H\.?\s?R|S)`;
const NUMBER = new RegExp(String.raw`(?<![A-Za-z.'’])${TYPE}[.,]?\s?(\d{1,5})(?!\d|-\d)`, "giu");
const LAW = /\b(?:P\.?\s?L\.?|Pub(?:lic|\.)?\s+L(?:aw|\.)?)\s*(?:No[.:]?\s*)?(\d{2,3})\s*[-–]\s*(\d{1,3})\b/giu;
const OTHER_ACT = /\b[A-Z][\w'’-]*(?:\s+(?:[A-Z][\w'’-]*|of|the|and|for|to|in|on))*\s+Act\b/u;
const CONGRESS = /\b(1\d\d)(?:th|st|nd|rd)\s+Congress/iu;

const SECTION =
  /\bSec(?:tion)?s?\.?\s*(\d{1,6}[A-Za-z]?)((?:\s*(?:,|and|&|through|to|-|–)\s*(?:Sec(?:tion)?s?\.?\s*)?\d{1,6}[A-Za-z]?)*)/giu;

function typeOf(raw: string): BillType {
  const letters = raw.toLowerCase().replaceAll(/[^a-z]/gu, "");
  const type = BILL_TYPES.find((t) => t === letters);

  if (type === undefined) {
    throw new Error(`not a bill type: ${raw}`);
  }

  return type;
}

export function billNumbers(text: string) {
  return [...text.matchAll(NUMBER)].flatMap((m) =>
    m[1] === "s" || m[1] === undefined
      ? []
      : [{ type: typeOf(m[1]), number: Number(m[2]), index: m.index, text: m[0] }],
  );
}

export function clause(text: string, start: number, end: number, prevEnd = 0, nextStart = text.length) {
  const before = text
    .slice(Math.max(start - 70, prevEnd), start)
    .split(/[;\n]/u)
    .at(-1);

  const after = text.slice(end, Math.min(end + 90, nextStart)).split(/[;\n]/u)[0];

  return (before ?? "") + text.slice(start, end) + (after ?? "");
}

const escapeRe = (s: string) => s.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

export function transpositions(word: string): string[] {
  const out: string[] = [];

  for (let i = 0; i < word.length - 1; i++) {
    if (word[i] !== word[i + 1]) {
      out.push(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
    }
  }

  return out;
}

const isAcronymWord = (w: string) => /^[A-Z]{5,}$/u.test(w);

export function nameRegex(name: string): RegExp {
  const words = name.split(/\s+/u).map((w) => {
    if (/^U\.?S\.?$/iu.test(w)) {
      return String.raw`U\.?\s?S\.?`;
    }

    const bare = w.replace(/[.,:;]+$/u, "");
    const forms = isAcronymWord(bare) ? [bare, ...transpositions(bare)] : [bare];

    return `(?:${forms.map(escapeRe).join("|")})[.,:]?`;
  });

  return new RegExp(String.raw`(?<![A-Za-z])${words.join(String.raw`[\s,.\-–]+`)}(?![A-Za-z])`, "iu");
}

export function acronyms(name: string): string[] {
  const words = name.split(/\s+/u);

  if (words.length < 4 || !words.every((w) => /^[A-Z]/u.test(w)) || words.some((w) => isAcronymWord(w))) {
    return [];
  }

  const full = words.map((w) => w[0]).join("");

  return name.endsWith("Act") ? [full, full.slice(0, -1)] : [full];
}

export function nameForms(title: string): string[] {
  const base = title.replace(/\s+of\s+(?:19|20)\d\d$/iu, "").trim();
  const noAct = base.replace(/\s+Act$/iu, "");

  return noAct !== base && noAct.split(/\s+/u).length >= 3 ? [noAct] : [base];
}

export interface Matcher {
  aliases: Aliases;
  names: { re: RegExp; level: Exclude<Level, "low">; since: string | null; why: string; acronym: boolean }[];
  rivals: RegExp[];
  support: RegExp[];
  numbers: Map<string, { id: BillId; introduced: string | null }>;
}

export function matcher(a: Aliases): Matcher {
  const names: Matcher["names"] = [];

  for (const n of a.names) {
    names.push({ re: nameRegex(n.text), level: n.level, since: n.since, why: n.why, acronym: false });

    for (const [i, ac] of acronyms(n.title).entries()) {
      names.push({
        re: new RegExp(`(?<![A-Za-z])${ac}(?![A-Za-z])`, "u"),
        level: i === 0 ? n.level : "medium",
        since: n.since,
        why: `acronym of "${n.title}"`,
        acronym: true,
      });
    }
  }

  const numbers = new Map(
    a.numbers.map((n) => {
      const { type, number } = billRef(n.id);

      return [`${type}${number}`, n];
    }),
  );

  return {
    aliases: a,
    names,
    rivals: a.rivals.map((r) => nameRegex(r)),
    support: a.support.map((s) => (/^[a-z]+$/u.test(s) ? new RegExp(`\\b${s}\\b`, "iu") : supportNumberRegex(s))),
    numbers,
  };
}

function supportNumberRegex(display: string): RegExp {
  const m = /^(.*?)(\d+)$/u.exec(display);

  if (m === null) {
    throw new Error(`not a bill number: ${display}`);
  }

  const letters = (m[1] ?? "").replaceAll(/[^A-Za-z]/gu, "").split(/(?=[A-Z])/u);

  return new RegExp(`(?<![A-Za-z])${letters.map(escapeRe).join(String.raw`\.?\s?`)}\\.?\\s?${m[2] ?? ""}(?!\\d)`, "iu");
}

export function findRefs(text: string, p: Period, m: Matcher): Ref[] {
  const a = m.aliases;
  const refs: Ref[] = [];
  const nums = billNumbers(text);
  const names = (s: string) => m.names.some((n) => n.re.test(s)) || a.laws.some((l) => s.includes(l));

  for (const [i, n] of nums.entries()) {
    const hit = m.numbers.get(`${n.type}${n.number}`);

    if (!hit) {
      continue;
    }

    const end = n.index + n.text.length;

    const prev = nums[i - 1];

    const c = clause(
      text,
      n.index,
      end,
      prev === undefined ? undefined : prev.index + prev.text.length,
      nums[i + 1]?.index,
    );

    const named = names(c);
    const explicit = CONGRESS.exec(c);
    const congress = explicit ? Number(explicit[1]) : congressOf(p.year);
    const rival = m.rivals.map((r) => c.match(r)).find((x) => x !== null);
    const support = m.support.map((r) => c.match(r)).find((x) => x !== null);
    let level: Level;
    let why: string;

    if (!named && /^\s\d{1,4}\b/u.test(text.slice(end))) {
      level = "low";
      why = "digits right after the number look like a split bill number";
    } else if (congress !== a.congress) {
      [level, why] = [
        "low",
        explicit ? `text says ${explicit[0]}` : `filed in the ${congress}th Congress, the bill is ${a.congress}th`,
      ];
    } else if (rival && !named) {
      [level, why] = ["low", `the clause names another bill with this number: "${rival[0]}"`];
    } else if (!named && /companion/iu.test(c) && OTHER_ACT.test(c)) {
      [level, why] = ["low", `the clause calls it the companion of another bill: "${OTHER_ACT.exec(c)?.[0] ?? ""}"`];
    } else if (hit.introduced !== null && hit.introduced !== "" && p.end < hit.introduced) {
      [level, why] = ["low", `period ends ${p.end}, before ${n.text.trim()} was introduced ${hit.introduced}`];
    } else if (named) {
      [level, why] = ["high", "the number sits next to the bill's name or public law"];
    } else if (support) {
      [level, why] = ["high", `the number matches and the clause says "${support[0]}"`];
    } else {
      [level, why] = ["medium", "the number matches, same Congress, after introduction"];
    }

    refs.push({ how: "number", text: n.text.trim(), level, why });
  }

  for (const n of m.names) {
    const hit = text.match(n.re);

    if (!hit) {
      continue;
    }

    const early = n.since !== null && n.since !== "" && p.end < n.since;

    const labeledBy = billNumbers(text.slice(0, hit.index))
      .filter((x) => !m.numbers.has(`${x.type}${x.number}`))
      .map((x) => ({ ...x, between: text.slice(x.index + x.text.length, hit.index) }))
      .at(-1);

    const other =
      labeledBy !== undefined && labeledBy.between.length <= 50 && !/[.;]\s|\n|\band\b/iu.test(labeledBy.between);

    const [level, why]: [Level, string] = early
      ? ["low", `period ends ${p.end}, before any bill carried the name (${n.since}): it meant an agenda`]
      : other
        ? ["low", `the name is the title of another bill: "${labeledBy?.text.trim() ?? ""}"`]
        : [n.level, n.why];

    refs.push({ how: "name", text: hit[0], level, why });
  }

  let lawCited = false;
  const ours = (n: { type: string; number: number }) => m.numbers.has(`${n.type}${n.number}`);

  const conflict = (at: number, len: number) => {
    const near = clause(text, at, at + len);
    const numbers = billNumbers(near);

    return numbers.some((n) => !ours(n)) && !numbers.some(ours) && !m.names.some((x) => x.re.test(near));
  };

  for (const l of text.matchAll(LAW)) {
    if (!a.laws.includes(`${l[1]}-${l[2]}`)) {
      continue;
    }

    lawCited = true;
    refs.push(
      conflict(l.index, l[0].length)
        ? { how: "public-law", text: l[0], level: "low", why: "the public law sits next to another bill's number" }
        : { how: "public-law", text: l[0], level: "high", why: "public law number" },
    );
  }

  if (!lawCited) {
    for (const law of a.laws) {
      const hit = new RegExp(`(?<![\\d-])${law}(?![\\d-])`, "u").exec(text);

      if (hit && !conflict(hit.index, hit[0].length)) {
        refs.push({ how: "public-law", text: hit[0], level: "medium", why: "bare public law number" });
      }
    }
  }

  return refs;
}

const RANK: Record<Level, number> = { high: 2, medium: 1, low: 0 };

export function best(refs: Ref[]): Ref | null {
  return refs.reduce<Ref | null>((b, r) => (!b || RANK[r.level] > RANK[b.level] ? r : b), null);
}

const BEFORE = /^[\s\-–—,:([]*(?:(?:the\s+)?provisions?\s+(?:in|of)\s+)?$/iu;
const AFTER = /^\s*(?:\([^)]*\)\s*)*(?:of|in|to|under|from)\s+(?:the\s+)?$/iu;

export function sectionNums(text: string, m: Matcher): string[] {
  const own = billRef(m.aliases.bill);
  const anchors: { start: number; end: number; ours: boolean; number: boolean }[] = [];

  for (const n of billNumbers(text)) {
    anchors.push({
      start: n.index,
      end: n.index + n.text.length,
      ours: n.type === own.type && n.number === own.number,
      number: true,
    });
  }

  for (const n of m.names) {
    for (const h of text.matchAll(new RegExp(n.re.source, `${n.re.flags.replace("g", "")}g`))) {
      anchors.push({ start: h.index, end: h.index + h[0].length, ours: true, number: false });
    }
  }

  for (const law of m.aliases.laws) {
    for (const h of text.matchAll(new RegExp(`(?<![\\d-])${law}(?![\\d-])`, "gu"))) {
      anchors.push({ start: h.index, end: h.index + law.length, ours: true, number: false });
    }
  }

  const out = new Set<string>();

  for (const s of text.matchAll(SECTION)) {
    const start = s.index;
    const end = start + s[0].length;

    const before = anchors.find(
      (a) => a.number && a.end <= start && a.end >= start - 40 && BEFORE.test(text.slice(a.end, start)),
    );

    const after = anchors.find((a) => a.start >= end && a.start <= end + 60 && AFTER.test(text.slice(end, a.start)));
    const tail = text.slice(end, end + 90);
    const elsewhere = /^\s*(?:\([^)]*\)\s*)*(?:of\s|(?:U\.?S\.?C|IRC|I\.R\.C))/iu.test(tail) && !after;
    const anchor = after ?? before;

    if (elsewhere || anchor?.ours !== true || s[1] === undefined) {
      continue;
    }

    out.add(s[1]);

    for (const more of (s[2] ?? "").matchAll(/\d{1,6}[A-Za-z]?/gu)) {
      out.add(more[0]);
    }
  }

  return [...out];
}
