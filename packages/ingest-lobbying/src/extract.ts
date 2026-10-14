import { type BillId, type BillType, billRef } from "@antibody/core";

export type Level = "high" | "medium" | "low";

/** Everything a filing might call the bill, built from BILLSTATUS (see aliases.ts). */
export interface Aliases {
  bill: BillId;
  congress: number;
  /** The bill's own number plus earlier bills that carried the same short title (S.394 and S.919 for S.1582). */
  numbers: { id: BillId; introduced: string | null; why: string }[];
  /** `since` is the earliest introduction of a bill carrying the name; before it, the name meant an agenda. */
  names: { text: string; title: string; level: Exclude<Level, "low">; since: string | null; why: string }[];
  /** Public law numbers, "119-27". */
  laws: string[];
  introduced: string | null;
  enactedOn: string | null;
  /** Titles and laws of bills that reused one of our numbers in another Congress (H.R.1 was TCJA in the 115th). */
  rivals: string[];
  /** Measures the official title cites, and "reconciliation" when it says so. */
  support: string[];
  years: number[];
}

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

const PERIODS: Record<string, [string, string]> = {
  first_quarter: ["01-01", "03-31"],
  second_quarter: ["04-01", "06-30"],
  third_quarter: ["07-01", "09-30"],
  fourth_quarter: ["10-01", "12-31"],
  mid_year: ["01-01", "06-30"],
  year_end: ["07-01", "12-31"],
};

export function period(year: number, code: string): Period {
  const [start, end] = PERIODS[code] ?? ["01-01", "12-31"];
  return { year, start: `${year}-${start}`, end: `${year}-${end}` };
}

export const congressOf = (year: number) => Math.floor((year - 1789) / 2) + 1;

const TYPE = String.raw`(H\.?\s?J\.?\s?Res|S\.?\s?J\.?\s?Res|H\.?\s?Con\.?\s?Res|S\.?\s?Con\.?\s?Res|H\.?\s?Res|S\.?\s?Res|H\.?\s?R|S)`;
const NUMBER = new RegExp(String.raw`(?<![A-Za-z.'’])${TYPE}[.,]?\s?(\d{1,5})(?!\d|-\d)`, "gi");
const LAW = /\b(?:P\.?\s?L\.?|Pub(?:lic|\.)?\s+L(?:aw|\.)?)\s*(?:No[.:]?\s*)?(\d{2,3})\s*[-–]\s*(\d{1,3})\b/gi;
const CONGRESS = /\b(1\d\d)(?:th|st|nd|rd)\s+Congress/i;
const SECTION =
  /\bSec(?:tion)?s?\.?\s*(\d{1,6}[A-Za-z]?)((?:\s*(?:,|and|&|through|to|-|–)\s*(?:Sec(?:tion)?s?\.?\s*)?\d{1,6}[A-Za-z]?)*)/gi;

const typeOf = (raw: string): BillType => raw.toLowerCase().replace(/[^a-z]/g, "") as BillType;

/** Every bill number in a text, with its position. A bare "S" must be capital: "America's 1" is not S.1. */
export function billNumbers(text: string) {
  return [...text.matchAll(NUMBER)]
    .filter((m) => !(m[1] === "s"))
    .map((m) => ({ type: typeOf(m[1]!), number: Number(m[2]), index: m.index!, text: m[0] }));
}

/** The clause around a match: up to the neighbouring bill numbers, cut at `;` and line breaks. */
export function clause(text: string, start: number, end: number, prevEnd = 0, nextStart = text.length) {
  const before = text
    .slice(Math.max(start - 70, prevEnd), start)
    .split(/[;\n]/)
    .pop()!;
  const after = text.slice(end, Math.min(end + 90, nextStart)).split(/[;\n]/)[0]!;
  return before + text.slice(start, end) + after;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Adjacent-letter swaps of a long all-caps word: GENIUS → GENUIS. Filers make these typos. */
export function transpositions(word: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < word.length - 1; i++)
    if (word[i] !== word[i + 1]) out.push(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
  return out;
}

const isAcronymWord = (w: string) => /^[A-Z]{5,}$/.test(w);

/** "Guiding … for U.S. Stablecoins" → a regex that tolerates punctuation, spacing and acronym typos. */
export function nameRegex(name: string): RegExp {
  const words = name.split(/\s+/).map((w) => {
    if (/^U\.?S\.?$/i.test(w)) return String.raw`U\.?\s?S\.?`;
    const bare = w.replace(/[.,:;]+$/, "");
    const forms = isAcronymWord(bare) ? [bare, ...transpositions(bare)] : [bare];
    return `(?:${forms.map(escapeRe).join("|")})[.,:]?`;
  });
  return new RegExp(String.raw`(?<![A-Za-z])${words.join(String.raw`[\s,.\-–]*\s`)}(?![A-Za-z])`, "i");
}

/** "One Big Beautiful Bill Act" → OBBBA (and OBBB): only for 4+ capitalized words, so IRA never collides. */
export function acronyms(name: string): string[] {
  const words = name.split(/\s+/);
  if (words.length < 4 || !words.every((w) => /^[A-Z]/.test(w)) || words.some((w) => isAcronymWord(w))) return [];
  const full = words.map((w) => w[0]).join("");
  return /Act$/.test(name) ? [full, full.slice(0, -1)] : [full];
}

/** The forms of a name we search and match: the title without "of 2025", and without "Act" when 3+ words remain. */
export function nameForms(title: string): string[] {
  const base = title.replace(/\s+of\s+(?:19|20)\d\d$/i, "").trim();
  const noAct = base.replace(/\s+Act$/i, "");
  return noAct !== base && noAct.split(/\s+/).length >= 3 ? [noAct] : [base];
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
    for (const [i, ac] of acronyms(n.title).entries())
      names.push({
        re: new RegExp(`(?<![A-Za-z])${ac}(?![A-Za-z])`),
        level: i === 0 ? n.level : "medium",
        since: n.since,
        why: `acronym of "${n.title}"`,
        acronym: true,
      });
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
    support: a.support.map((s) => (/^[a-z]+$/.test(s) ? new RegExp(`\\b${s}\\b`, "i") : supportNumberRegex(s))),
    numbers,
  };
}

function supportNumberRegex(display: string): RegExp {
  const m = display.match(/^(.*?)(\d+)$/)!;
  const letters = m[1]!.replace(/[^A-Za-z]/g, "").split(/(?=[A-Z])/);
  return new RegExp(`(?<![A-Za-z])${letters.map(escapeRe).join(String.raw`\.?\s?`)}\\.?\\s?${m[2]}(?!\\d)`, "i");
}

/** Every way an issue line refers to the bill, each labeled with how sure we are and why. */
export function findRefs(text: string, p: Period, m: Matcher): Ref[] {
  const a = m.aliases;
  const refs: Ref[] = [];
  const nums = billNumbers(text);
  const names = (s: string) => m.names.some((n) => n.re.test(s)) || a.laws.some((l) => s.includes(l));

  for (const [i, n] of nums.entries()) {
    const hit = m.numbers.get(`${n.type}${n.number}`);
    if (!hit) continue;
    const end = n.index + n.text.length;
    const c = clause(
      text,
      n.index,
      end,
      nums[i - 1] && nums[i - 1]!.index + nums[i - 1]!.text.length,
      nums[i + 1]?.index,
    );
    const named = names(c);
    const explicit = c.match(CONGRESS);
    const congress = explicit ? Number(explicit[1]) : congressOf(p.year);
    const rival = m.rivals.map((r) => c.match(r)).find(Boolean);
    const support = m.support.map((r) => c.match(r)).find(Boolean);
    let level: Level;
    let why: string;
    if (!named && /^\s\d{1,4}\b/.test(text.slice(end))) {
      level = "low";
      why = "digits right after the number look like a split bill number";
    } else if (congress !== a.congress)
      [level, why] = [
        "low",
        explicit ? `text says ${explicit[0]}` : `filed in the ${congress}th Congress, the bill is ${a.congress}th`,
      ];
    else if (rival && !named) [level, why] = ["low", `the clause names another bill with this number: "${rival[0]}"`];
    else if (hit.introduced && p.end < hit.introduced)
      [level, why] = ["low", `period ends ${p.end}, before ${n.text.trim()} was introduced ${hit.introduced}`];
    else if (named) [level, why] = ["high", "the number sits next to the bill's name or public law"];
    else if (support) [level, why] = ["high", `the number matches and the clause says "${support[0]}"`];
    else [level, why] = ["medium", "the number matches, same Congress, after introduction"];
    refs.push({ how: "number", text: n.text.trim(), level, why });
  }

  for (const n of m.names) {
    const hit = text.match(n.re);
    if (!hit) continue;
    const early = n.since && p.end < n.since;
    refs.push({
      how: "name",
      text: hit[0],
      level: early ? "low" : n.level,
      why: early ? `period ends ${p.end}, before any bill carried the name (${n.since}): it meant an agenda` : n.why,
    });
  }

  let lawCited = false;
  for (const l of text.matchAll(LAW))
    if (a.laws.includes(`${l[1]}-${l[2]}`)) {
      lawCited = true;
      refs.push({ how: "public-law", text: l[0], level: "high", why: "public law number" });
    }
  if (!lawCited)
    for (const law of a.laws) {
      const hit = text.match(new RegExp(`(?<![\\d-])${law}(?![\\d-])`));
      if (hit) refs.push({ how: "public-law", text: hit[0], level: "medium", why: "bare public law number" });
    }
  return refs;
}

const RANK: Record<Level, number> = { high: 2, medium: 1, low: 0 };

export function best(refs: Ref[]): Ref | null {
  return refs.reduce<Ref | null>((b, r) => (!b || RANK[r.level] > RANK[b.level] ? r : b), null);
}

/**
 * Section numbers the line cites for this bill. A section followed by "of <another law>" (the Internal Revenue
 * Code, a U.S.C. title, another Act) is left out; store keeps only numbers that exist in the bill.
 */
export function sectionNums(text: string, m: Matcher): string[] {
  const out = new Set<string>();
  for (const s of text.matchAll(SECTION)) {
    const after = text.slice(s.index! + s[0].length, s.index! + s[0].length + 90);
    const of = after.match(/^\s*(?:\([^)]*\)\s*)*of\s+(?:the\s+)?([^;,]{0,80})/i);
    if (of) {
      const target = of[1]!;
      const ours =
        m.names.some((n) => n.re.test(target)) ||
        billNumbers(target).some((n) => m.numbers.has(`${n.type}${n.number}`)) ||
        m.aliases.laws.some((l) => target.includes(l));
      if (!ours) continue;
    } else if (/^\s*(?:\([^)]*\)\s*)*(?:U\.?S\.?C|IRC|I\.R\.C)/i.test(after)) continue;
    out.add(s[1]!);
    for (const more of (s[2] ?? "").matchAll(/\d{1,6}[A-Za-z]?/g)) out.add(more[0]);
  }
  return [...out];
}
