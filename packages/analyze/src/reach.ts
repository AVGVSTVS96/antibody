import type { Row } from "@antibody/core";

export const REACH_VERSION = "reach-v2";

export type ReachKind = Row<"section_reach">["kind"];

interface Pattern {
  id: string;
  kind: ReachKind;
  re: RegExp;
}

const STATE = `State(?:,? or (?:a |any )?(?:(?:political )?subdivision(?: of a State| thereof)?|unit of local government|local government))?,?`;
const BLOCK = `(?:propose|issue|finalize|promulgate|implement|administer|enforce|apply)`;

const RULE = String.raw`\b(?:the|any|a|such|new)(?: [^\s.;]+){0,4}? (?:rules?|regulations?)\b`;

const REVIEW_LAW = `(?:the )?(?:requirements of )?(?:the )?(?:National Environmental Policy Act(?: of 1969)?|section 553 of title 5|sections? 551 through 559 of title 5|(?:subchapter II of )?chapter 5 of title 5|Administrative Procedure Act|notice and comment)`;

export const PATTERNS: Pattern[] = [
  {
    id: "no-court",
    kind: "courts",
    re: /\bno (?:federal )?courts?(?: of the United States)?(?:,[^,]{0,60},)? (?:shall|may) (?:have jurisdiction|enforce|issue|enjoin|grant|hear|entertain|review|use|order|stay|set aside|vacate)\b/iu,
  },
  {
    id: "no-judicial-review",
    kind: "courts",
    re: /\b(?:shall not be|is not|are not|not be) subject to (?:administrative or )?judicial review\b/iu,
  },
  {
    id: "no-judicial-review",
    kind: "courts",
    re: /\bNo (?!later|earlier|more|less|fewer)[^.;]{0,160}?\bshall be subject to (?:administrative or )?judicial review\b/u,
  },
  {
    id: "no-suit",
    kind: "courts",
    re: /\bno person may (?:bring|commence|file|maintain) (?:a civil action|an action|suit|a claim)\b/iu,
  },
  {
    id: "no-injunction",
    kind: "courts",
    re: /\b(?:(?:shall|may) not (?:issue|grant|enter) (?:a |an |any )?(?:temporary restraining order|preliminary injunction|injunction)|no (?:temporary restraining order|preliminary injunction|injunction) (?:shall|may) (?:issue|be issued|be granted))\b/iu,
  },
  {
    id: "limits-remedy",
    kind: "courts",
    re: /\bthe only remedy (?:that )?(?:the|a) court may (?:order|grant|award)\b|\bwithout vacatur or injunction\b/iu,
  },
  {
    id: "no-state-may",
    kind: "states",
    re: new RegExp(
      String.raw`\b(?:no ${STATE} (?:may|shall)|an? ${STATE} (?:may|shall) not) (?:\w+, )*(?:or )?(?:enforce|enact|adopt|establish|impose|maintain|prescribe|continue in effect)\b[^.;]{0,100}?\b(?:any|a) (?:\w+ ){0,3}?(?:laws?|statutes?|regulations?|requirements?|ordinances?|standards?)\b`,
      "iu",
    ),
  },
  {
    id: "supersedes-state-law",
    kind: "states",
    re: /\b(?:supersedes?|preempts?)(?: and (?:supersedes?|preempts?))? (?:any|a|all) (?:law|statute|requirement|regulation|provision)s?(?: of (?:a|any) State| of State law)\b|\b(?:supersedes?|preempts?)(?: and (?:supersedes?|preempts?))? (?:any|all) State (?:or local )?(?:laws?|statutes?|requirements?|regulations?)\b/iu,
  },
  {
    id: "sue-the-united-states",
    kind: "lawsuit",
    re: /\bmay bring (?:a civil action|an action|suit) against the United States\b|\bmay bring (?:a civil action|an action) in [^.;]{0,120}to obtain appropriate relief for harm\b/iu,
  },
  {
    id: "standing-to-sue",
    kind: "lawsuit",
    re: /\bstanding to bring (?:a civil action|an action|suit) against (?:the United States|the (?:Attorney General|Secretary|Administrator|Director|Commissioner)\b)/iu,
  },
  {
    id: "set-damages",
    kind: "lawsuit",
    re: /\b(?:statutory|liquidated) damages (?:of|in the amount of) \$[\d,]+/iu,
  },
  {
    id: "waives-sovereign-immunity",
    kind: "lawsuit",
    re: /\bwaives? (?:its |the )?sovereign immunity\b|\bsovereign immunity (?:of the United States )?is (?:hereby )?waived\b/iu,
  },
  {
    id: "no-immunity-defense",
    kind: "lawsuit",
    re: /\b(?:shall not be entitled to|may not) assert (?:any form of )?(?:absolute or )?qualified immunity\b|\bno [^.;]{0,120}shall be entitled to assert [^.;]{0,30}immunity\b/iu,
  },
  {
    id: "skips-review-law",
    kind: "review",
    re: new RegExp(
      String.raw`\bwithout regard to [^.;]{0,60}${REVIEW_LAW}|${REVIEW_LAW}[^.;]{0,80}\b(?:shall not apply|does not apply|do not apply|shall not be applicable)\b|\b(?:shall not be|is not|are not|not be) subject to [^.;]{0,40}${REVIEW_LAW}|\bexempt(?:ed)? from [^.;]{0,60}${REVIEW_LAW}`,
      "iu",
    ),
  },
  {
    id: "deemed-to-satisfy-law",
    kind: "review",
    re: /\bdeemed to (?:satisfy|comply with|have satisfied|have complied with) (?:all )?(?:the )?requirements of (?:all )?(?:applicable )?(?:Federal law|the National Environmental Policy Act)\b/iu,
  },
  {
    id: "rule-no-force",
    kind: "rule",
    re: /\b(?:rules?|regulations?|Secretarial Order|guidance|Fed\. Reg\. [\d,]+)[^.;]{0,160}\bshall have no (?:force or effect|force and effect|legal effect)\b/iu,
  },
  {
    id: "no-funds-for-rule",
    kind: "rule",
    re: new RegExp(
      String.raw`\bNone of the funds [^.]{0,160}\b(?:may|shall) (?:be used|be available|be obligated or expended)[^.]{0,80}\b${BLOCK}\b[^.;]{0,100}?${RULE}`,
      "iu",
    ),
  },
  {
    id: "may-not-carry-out-rule",
    kind: "rule",
    re: new RegExp(
      String.raw`\b(?:shall|may) not(?:,[^.;]{0,60}?,)? (?:use any authority to )?(?:\w+, )*(?:or )?(?:propose|issue|finalize|promulgate|implement|administer|enforce)\b[^.;]{0,60}?${RULE}`,
      "iu",
    ),
  },
];

const BOUNDARY =
  /(?:(?<!\b(?:U\.S|Pub|No|Nos|Sec|Secs|Fed|Reg|Stat|seq|et|Inc|Co|Corp|v|St|Jr|Dr|Mr|Ms))\.\s+(?=[A-Z(]|\d+[A-Z]? [A-Z]{2,}))|\.-\s+/gu;

const NEGATED =
  /\b(?:nothing in|shall not be construed|may not be construed|be construed (?:to|as)|construed to|is not intended|nor shall|shall have no effect on)\b|\b(?:shall|may|does|do) not\s*[-—–]/iu;

const STRUCK = /\bstrik(?:e|es|ing) ["“]?\s*$/iu;
const NOT_BEFORE = /\b(?:not|nor|no)\s+$/iu;
const MAX_QUOTE = 420;

const STATE_PATTERNS = PATTERNS.filter((p) => p.kind === "states");

const DISAPPROVED = /\bdisapproved pursuant to a joint resolution\b/iu;

export interface ReachTag {
  kind: ReachKind;
  pattern: string;
  quote: string;
}

function sentenceAround(text: string, start: number, end: number): [number, number] {
  let from = 0;
  BOUNDARY.lastIndex = 0;

  for (let m = BOUNDARY.exec(text); m && m.index < start; m = BOUNDARY.exec(text)) {
    from = m.index + m[0].length;
  }

  BOUNDARY.lastIndex = end;
  const next = BOUNDARY.exec(text);

  return [from, next ? next.index + 1 : text.length];
}

function quoteOf(text: string, from: number, to: number, start: number, end: number): string {
  if (to - from <= MAX_QUOTE) {
    return text.slice(from, to).trim();
  }

  const room = Math.max(0, MAX_QUOTE - (end - start));
  const a = Math.max(from, start - Math.floor(room / 3));
  const b = Math.min(to, end + room - (start - a));
  const cutFrom = a > from ? text.indexOf(" ", a) + 1 || a : from;
  const cutTo = b < to ? text.lastIndexOf(" ", b) : to;

  return text.slice(cutFrom, cutTo).trim();
}

export function reach(text: string): ReachTag[] {
  const out = new Map<ReachKind, ReachTag>();

  for (const p of PATTERNS) {
    if (out.has(p.kind)) {
      continue;
    }

    const re = new RegExp(p.re.source, `${p.re.flags.replace("g", "")}g`);

    for (const m of text.matchAll(re)) {
      const start = m.index;
      const end = start + m[0].length;
      const [from, to] = sentenceAround(text, start, end);
      const before = text.slice(from, start);

      if (NEGATED.test(before) || NEGATED.test(m[0]) || STRUCK.test(text.slice(Math.max(0, start - 12), start))) {
        continue;
      }

      if (NOT_BEFORE.test(text.slice(Math.max(0, start - 12), start))) {
        continue;
      }

      const sentence = text.slice(from, to);

      if (p.kind === "rule" && (STATE_PATTERNS.some((s) => s.re.test(sentence)) || DISAPPROVED.test(sentence))) {
        continue;
      }

      out.set(p.kind, { kind: p.kind, pattern: p.id, quote: quoteOf(text, from, to, start, end) });
      break;
    }
  }

  return [...out.values()];
}
