import { bills, type Bill } from "./bills";

export type Ref = {
  bill: string;
  how: "number" | "name" | "public-law";
  text: string;
  confidence: "high" | "medium" | "low";
  why: string;
};

const congressOf = (year: number) => Math.floor((year - 1789) / 2) + 1;
const quarterStart: Record<string, string> = {
  first_quarter: "01-01", second_quarter: "04-01", third_quarter: "07-01", fourth_quarter: "10-01",
  mid_year: "01-01", year_end: "07-01",
};
const quarterEnd: Record<string, string> = {
  first_quarter: "03-31", second_quarter: "06-30", third_quarter: "09-30", fourth_quarter: "12-31",
  mid_year: "06-30", year_end: "12-31",
};

type Target = {
  bill: string;
  numbers: { chamber: "hr" | "s"; num: number; introduced: string }[];
  names: RegExp[];
  laws: string[];
  rivals: RegExp;
  support?: RegExp;
};

const targets: Record<string, Target> = {
  genius: {
    bill: "genius",
    numbers: [
      { chamber: "s", num: 1582, introduced: "2025-05-01" },
      { chamber: "s", num: 394, introduced: "2025-02-04" },
      { chamber: "s", num: 919, introduced: "2025-03-10" },
    ],
    names: [/\bGEN(?:IU|UI)S\s+Act\b/i, /Guiding and Establishing National Innovation for U\.?S\.? Stablecoins/i],
    laws: ["119-27"],
    rivals: /\b(STABLE Act|CLARITY Act|Anti-CBDC)\b/i,
  },
  obbba: {
    bill: "obbba",
    numbers: [{ chamber: "hr", num: 1, introduced: "2025-05-20" }],
    support: /\breconciliation\b|H\.\s?Con\.\s?Res\.\s?14\b|\bSec(?:tion)?s?\.?\s*7\d{4}\b/i,
    names: [/\bOne,?\.? Big,?\.? Beautiful Bill\b/i, /\bOBB?BA?\b/, /\bBig,?\.? Beautiful Bill\b/i],
    laws: ["119-21"],
    rivals: /\b(Tax Cuts and Jobs Act|TCJA|115-97|115th|For the People Act|Lower Energy Costs Act|118th|117th)\b/i,
  },
  ira: {
    bill: "ira",
    numbers: [{ chamber: "hr", num: 5376, introduced: "2021-09-27" }],
    names: [/\bInflation Reduction Act\b/i, /\bBuild Back Better Act\b/i, /\bBuild Back Better\b/i],
    laws: ["117-169"],
    rivals: /\b(116th|118th|119th)\b/i,
  },
};

const numberRe = /(?<![A-Za-z.])(H\.?\s?R[.,]?|S\.?)\s?(\d{1,5})(?!\d|-\d)/gi;
const lawRe = /\b(?:P\.?\s?L\.?|Pub(?:lic|\.)?\s+L(?:aw|\.)?)\s*(?:No[.:]?\s*)?(\d{2,3})\s*[-–]\s*(\d{1,3})\b/gi;

export function findRefs(text: string, filingYear: number, period: string, billKey: string): Ref[] {
  const t = targets[billKey]!;
  const refs: Ref[] = [];
  const congress = congressOf(filingYear);
  const periodStart = `${filingYear}-${quarterStart[period] ?? "01-01"}`;
  const periodEnd = `${filingYear}-${quarterEnd[period] ?? "12-31"}`;

  const all = [...text.matchAll(numberRe)];
  for (const [i, m] of all.entries()) {
    const chamber = m[1]!.toUpperCase().startsWith("H") ? "hr" : "s";
    const num = Number(m[2]);
    const hit = t.numbers.find((n) => n.chamber === chamber && n.num === num);
    if (!hit) continue;
    const window = clause(text, m.index!, m.index! + m[0].length, all[i - 1], all[i + 1]);
    const rival = window.match(t.rivals);
    const named = t.names.some((r) => r.test(window)) || t.laws.some((l) => window.includes(l));
    const explicitCongress = window.match(/\b(1\d\d)(?:th|st|nd|rd)\s+Congress/i);
    const sameCongress = explicitCongress ? Number(explicitCongress[1]) === Number(targetCongress(billKey)) : congress === targetCongress(billKey);
    const existed = periodEnd >= hit.introduced;
    let confidence: Ref["confidence"];
    let why: string;
    const split = /^\s\d{1,4}\b/.test(text.slice(m.index! + m[0].length)) && !named;
    if (split) { confidence = "low"; why = "digits right after the number look like a split bill number"; }
    else if (!sameCongress) { confidence = "low"; why = explicitCongress ? `text says ${explicitCongress[0]}, bill is ${targetCongress(billKey)}th` : `filing is from the ${congress}th Congress, bill is ${targetCongress(billKey)}th`; }
    else if (rival && !named) { confidence = "low"; why = `nearby text names another bill: "${rival[0]}"`; }
    else if (!existed) { confidence = "low"; why = `filing period ends ${periodEnd}, before the bill was introduced ${hit.introduced}`; }
    else if (named) { confidence = "high"; why = "number sits next to the bill's name or public law"; }
    else if (t.support?.test(window)) { confidence = "high"; why = `number matches, same Congress, and the clause says "${window.match(t.support)![0]}"`; }
    else { confidence = chamber === "hr" && num === 1 ? "medium" : "high"; why = "number matches, same Congress, after introduction"; }
    refs.push({ bill: billKey, how: "number", text: m[0], confidence, why });
  }

  for (const r of t.names) {
    const m = text.match(r);
    if (!m) continue;
    let confidence: Ref["confidence"] = "high";
    let why = "bill named";
    if (billKey === "ira" && /^Build Back Better$/i.test(m[0]) && periodStart < "2021-07-01") {
      confidence = "low";
      why = "\"Build Back Better\" before H.R.5376 existed means the agenda, not the bill";
    } else if (billKey === "ira" && /Build Back Better/i.test(m[0])) {
      why = "H.R.5376 was titled the Build Back Better Act until Aug 2022";
      confidence = "medium";
    }
    if (billKey === "obbba" && /^OBB/.test(m[0])) { why = "acronym"; if (m[0] !== "OBBBA") confidence = "medium"; }
    refs.push({ bill: billKey, how: "name", text: m[0], confidence, why });
    break;
  }

  for (const m of text.matchAll(lawRe)) {
    const law = `${m[1]}-${m[2]}`;
    if (t.laws.includes(law)) refs.push({ bill: billKey, how: "public-law", text: m[0], confidence: "high", why: "public law number" });
  }
  if (!refs.some((r) => r.how === "public-law"))
    for (const law of t.laws) {
      const m = text.match(new RegExp(`(?<![\\d-])${law}(?![\\d-])`));
      if (m) refs.push({ bill: billKey, how: "public-law", text: m[0], confidence: "medium", why: "bare public law number" });
    }
  return refs;
}

function clause(text: string, start: number, end: number, prev?: RegExpMatchArray, next?: RegExpMatchArray) {
  const from = Math.max(start - 70, prev ? prev.index! + prev[0].length : 0);
  const to = Math.min(end + 90, next ? next.index! : text.length);
  const before = text.slice(from, start).split(/[;\n]/).pop()!;
  const after = text.slice(end, to).split(/[;\n]/)[0]!;
  return before + text.slice(start, end) + after;
}

function targetCongress(billKey: string) {
  return bills.find((b) => b.key === billKey)!.congress;
}

export function bestConfidence(refs: Ref[]): Ref["confidence"] | null {
  if (refs.some((r) => r.confidence === "high")) return "high";
  if (refs.some((r) => r.confidence === "medium")) return "medium";
  if (refs.length) return "low";
  return null;
}

export type { Bill };
