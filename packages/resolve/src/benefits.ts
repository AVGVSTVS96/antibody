import type { BillId, Row } from "@antibody/core";
import type { Company } from "./edgar.ts";
import { ownedOn, ownedSince } from "./since.ts";

const REF_CONFIDENCE = { high: 0.95, medium: 0.85, low: 0 } as const;
const MAX_RESTS_ON = 25;

/**
 * Rule "lobbied" (decision tied-stock): a company is tied to the bill when a lobbying client that resolves to it
 * filed an LD-1 or LD-2 naming the bill. One whole-bill row per company, plus one per section the filings cite by
 * number. Low-confidence references (held out by ingest-lobbying), filings replaced by an amendment, and filings from before a subsidiary came under its parent don't count;
 * topic-only lines live in lda_topic_refs and never count here (decision topic-only-lobbying).
 */
export function lobbiedBenefits(
  bill: BillId,
  refs: Row<"lda_bill_refs">[],
  filings: Map<string, Row<"lda_filings">>,
  resolutions: Map<string, Row<"resolutions">>,
  sections: Row<"sections">[],
): Row<"benefits">[] {
  const byNum = new Map<string, Row<"sections">[]>();
  for (const s of sections) byNum.set(s.num, [...(byNum.get(s.num) ?? []), s]);
  const sectionFor = (num: string) => {
    const hits = byNum.get(num) ?? [];
    return (hits.find((s) => s.in_final) ?? (hits.length === 1 ? hits[0] : undefined))?.id ?? null;
  };

  type Acc = {
    cik: string;
    section: string | null;
    refs: Row<"lda_bill_refs">[];
    res: Set<Row<"resolutions">>;
    topicOnly: number;
  };
  const acc = new Map<string, Acc>();
  const add = (cik: string, section: string | null, ref: Row<"lda_bill_refs">, res: Row<"resolutions">) => {
    const k = `${cik}\u0000${section ?? ""}`;
    const a = acc.get(k) ?? { cik, section, refs: [], res: new Set(), topicOnly: 0 };
    a.refs.push(ref);
    a.res.add(res);
    acc.set(k, a);
  };
  for (const ref of refs) {
    const filing = filings.get(ref.filing_id);
    if (ref.bill_id !== bill || ref.match === "low" || !filing || filing.superseded) continue;
    const res = resolutions.get(`client:${filing.client_key}`);
    if (!res || !ownedOn(ownedSince((res.evidence as { reason?: string }).reason), filing.period_end)) continue;
    add(res.company_id, null, ref, res);
    for (const num of ref.section_nums) {
      const id = sectionFor(num);
      if (id) add(res.company_id, id, ref, res);
    }
  }

  return [...acc.values()].map((a) => {
    const best = Math.max(...a.refs.map((r) => REF_CONFIDENCE[r.match]));
    const resolved = [...a.res];
    const refIds = [...new Set(a.refs.map((r) => `lda_bill_refs/${r.id}`))];
    return {
      id: `${bill}:lobbied:${a.cik}${a.section ? `:${a.section}` : ""}`,
      bill_id: bill,
      section_id: a.section,
      company_id: a.cik,
      basis_rule: "lobbied" as const,
      rule: "tied-stock",
      confidence: round(Math.min(best, Math.max(...resolved.map((r) => r.confidence)))),
      rests_on: [...resolved.map((r) => `resolutions/${r.id}`), ...refIds.slice(0, MAX_RESTS_ON)],
      evidence: {
        clients: resolved.map((r) => ({
          client: r.src,
          name: (r.evidence as { name?: string }).name ?? null,
          method: r.method,
        })),
        filings: new Set(a.refs.map((r) => r.filing_id)).size,
        refs: refIds.length,
        refsListed: Math.min(refIds.length, MAX_RESTS_ON),
        phases: countBy(a.refs.map((r) => r.phase)),
      },
    };
  });
}

const round = (x: number) => Math.round(x * 1000) / 1000;
const countBy = (xs: string[]) =>
  Object.fromEntries([...new Set(xs)].map((x) => [x, xs.filter((y) => y === x).length]));

/** One bill-level section of a text version: its number and its plain text (quoted amendments included). */
export interface TextSection {
  num: string | null;
  text: string;
}

/**
 * Splits a GovInfo bill XML (or USLM public law) into its own sections. A <section> inside a <quoted-block> is
 * text the bill inserts into existing law; its words belong to the bill section that inserts them.
 */
export function splitSections(xml: string): TextSection[] {
  const out: TextSection[] = [];
  const stack: string[] = [];
  let cur: TextSection | null = null;
  let wantEnum = false;
  const tag = /<(\/?)([A-Za-z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g;
  for (let m = tag.exec(xml); m; m = tag.exec(xml)) {
    const [, close, name, , selfClose, text] = m;
    if (text !== undefined) {
      if (!cur) continue;
      const t = decode(text);
      if (wantEnum && stack.at(-1) === "enum" && t.trim()) {
        cur.num = t
          .trim()
          .replace(/^(?:sec(?:tion)?\.?\s*)/i, "")
          .replace(/\.$/, "");
        wantEnum = false;
      }
      cur.text += t;
      continue;
    }
    const n = name!.toLowerCase();
    if (selfClose) continue;
    if (close) {
      const i = stack.lastIndexOf(n);
      if (i >= 0) stack.length = i;
      if (n === "section" && cur && !stack.includes("section")) {
        out.push(cur);
        cur = null;
      }
      continue;
    }
    if (
      n === "section" &&
      !stack.includes("section") &&
      !stack.some((s) => s === "quoted-block" || s === "quotedcontent")
    ) {
      cur = { num: null, text: "" };
      wantEnum = true;
    } else if (cur && /^(?:p|paragraph|subsection|text|header|heading|enum|content|chapeau)$/.test(n)) cur.text += " ";
    stack.push(n);
  }
  return out;
}

const decode = (s: string) =>
  s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi, (_, d, h, e) =>
    d
      ? String.fromCodePoint(+d)
      : h
        ? String.fromCodePoint(Number.parseInt(h, 16))
        : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()]!,
  );

export interface TextHit {
  cik: string;
  name: string;
  matched: string;
  num: string | null;
  context: string;
}

const LEGAL =
  /^,?\s*(?:Inc\.?|Incorporated|Corporation|Corp\.?|Company|Co\.|LLC|L\.L\.C\.|plc|PLC|Ltd\.?|Limited|N\.A\.|Holdings?)\b/;
const WORD = /[A-Za-z0-9&.'-]+/g;

/**
 * Finds SEC companies written into a bill's text, for the reviewer to confirm. A multi-word name must appear with
 * every word capitalized (bills capitalize proper nouns, so "general electric" never counts) and be the whole
 * capitalized run, so "American National" inside "American National Standards Institute" doesn't count; a one-word
 * name must be followed by a legal suffix ("Tesla, Inc."), since most one-word names are also ordinary words.
 */
export function findNames(sections: TextSection[], companies: Company[], norm: (s: string) => string): TextHit[] {
  const multi = new Map<string, Company[]>();
  const single = new Map<string, Company[]>();
  for (const c of companies) {
    const n = norm(c.name);
    const parts = n.split(" ").filter(Boolean);
    if (!parts.length || parts.every((p) => /^\d+$/.test(p))) continue;
    const into = parts.length > 1 ? multi : single;
    if (parts.length === 1 && parts[0]!.length < 3) continue;
    into.set(n, [...(into.get(n) ?? []), c]);
  }
  const maxLen = 6;
  const hits: TextHit[] = [];
  for (const s of sections) {
    const words = [...s.text.matchAll(WORD)].map((m) => ({ w: m[0], at: m.index! }));
    const keys = words.map((x) => x.w.toUpperCase().replace(/[^A-Z0-9]/g, ""));
    const cap = words.map((x) => /^[A-Z0-9]/.test(x.w));
    for (let i = 0; i < words.length; i++) {
      if (!cap[i]) continue;
      for (let len = Math.min(maxLen, words.length - i); len >= 1; len--) {
        if (!cap.slice(i, i + len).every(Boolean)) continue;
        const key = keys
          .slice(i, i + len)
          .filter(Boolean)
          .join(" ");
        const end = words[i + len - 1]!.at + words[i + len - 1]!.w.length;
        const suffixed = LEGAL.test(s.text.slice(end, end + 16));
        const found = len > 1 ? multi.get(key) : suffixed ? single.get(key) : undefined;
        if (!found) continue;
        const runsOn = !suffixed && cap[i + len] && /^\s+$/.test(s.text.slice(end, words[i + len]!.at));
        const runsIn =
          i > 0 &&
          cap[i - 1] &&
          !/^the$/i.test(words[i - 1]!.w) &&
          /^\s+$/.test(s.text.slice(words[i - 1]!.at + words[i - 1]!.w.length, words[i]!.at));
        if (runsOn || runsIn) break;
        const start = words[i]!.at;
        const matched = s.text.slice(start, end);
        const context = s.text
          .slice(Math.max(0, start - 220), end + 220)
          .replace(/\s+/g, " ")
          .trim();
        for (const c of found) hits.push({ cik: c.cik, name: c.name, matched, num: s.num, context });
        break;
      }
    }
  }
  return hits;
}
