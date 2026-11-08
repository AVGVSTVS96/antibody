import type { BillId, Row } from "@antibody/core";
import { filled } from "@antibody/core";
import type { Company } from "./edgar.ts";
import { ownedOn, ownedSince } from "./since.ts";

const REF_CONFIDENCE = { high: 0.95, medium: 0.85, low: 0 } as const;
const MAX_RESTS_ON = 25;

export function lobbiedBenefits(
  bill: BillId,
  refs: Row<"lda_bill_refs">[],
  filings: Map<string, Pick<Row<"lda_filings">, "client_key" | "superseded" | "period_end">>,
  resolutions: Map<string, Row<"resolutions">>,
  sections: Pick<Row<"sections">, "id" | "num" | "in_final">[],
): Row<"benefits">[] {
  const byNum = new Map<string, Pick<Row<"sections">, "id" | "in_final">[]>();

  for (const s of sections) {
    byNum.set(s.num, [...(byNum.get(s.num) ?? []), s]);
  }

  const sectionFor = (num: string) => {
    const hits = byNum.get(num) ?? [];

    return (hits.find((s) => s.in_final) ?? (hits.length === 1 ? hits[0] : undefined))?.id ?? null;
  };

  interface Acc {
    cik: string;
    section: string | null;
    refs: Row<"lda_bill_refs">[];
    res: Set<Row<"resolutions">>;
    topicOnly: number;
  }

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

    if (ref.bill_id !== bill || ref.match === "low" || !filing || filing.superseded) {
      continue;
    }

    const res = resolutions.get(`client:${filing.client_key}`);

    // SAFETY: review writes evidence.reason as the reviewer's reason string; other methods leave it out.
    if (!res || !ownedOn(ownedSince((res.evidence as { reason?: string }).reason), filing.period_end)) {
      continue;
    }

    add(res.company_id, null, ref, res);

    for (const num of ref.section_nums) {
      const id = sectionFor(num);

      if (filled(id)) {
        add(res.company_id, id, ref, res);
      }
    }
  }

  return [...acc.values()].map((a) => {
    const best = Math.max(...a.refs.map((r) => REF_CONFIDENCE[r.match]));
    const resolved = [...a.res];
    const refIds = [...new Set(a.refs.map((r) => `lda_bill_refs/${r.id}`))];

    return {
      id: `${bill}:lobbied:${a.cik}${filled(a.section) ? `:${a.section}` : ""}`,
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
          // SAFETY: toRow writes evidence.name as the mention's name string.
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

export interface TextSection {
  num: string | null;
  text: string;
}

export function splitSections(xml: string): TextSection[] {
  const out: TextSection[] = [];
  const stack: string[] = [];
  let cur: TextSection | null = null;
  let wantEnum = false;
  const tag = /<(\/?)([A-Za-z][\w-]*)([^>]*?)(\/?)>|([^<]+)/gu;

  for (let m = tag.exec(xml); m; m = tag.exec(xml)) {
    const [, close, name, , selfClose, chars] = m;

    if (chars !== undefined) {
      if (!cur) {
        continue;
      }

      const t = decode(chars);

      if (wantEnum && stack.at(-1) === "enum" && t.trim()) {
        cur.num = t
          .trim()
          .replace(/^(?:sec(?:tion)?\.?\s*)/iu, "")
          .replace(/\.$/u, "");
        wantEnum = false;
      }

      cur.text += t;
      continue;
    }

    if (name === undefined || selfClose === "/") {
      continue;
    }

    const n = name.toLowerCase();

    if (close === "/") {
      const i = stack.lastIndexOf(n);

      if (i !== -1) {
        stack.length = i;
      }

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
    } else if (cur && /^(?:p|paragraph|subsection|text|header|heading|enum|content|chapeau)$/u.test(n)) {
      cur.text += " ";
    }

    stack.push(n);
  }

  return out;
}

const ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

const decode = (s: string) =>
  s.replaceAll(
    /&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/giu,
    (entity: string, dec?: string, hex?: string, named?: string) => {
      if (filled(dec)) {
        return String.fromCodePoint(Number(dec));
      }

      if (filled(hex)) {
        return String.fromCodePoint(Number.parseInt(hex, 16));
      }

      return ENTITIES.get(named?.toLowerCase() ?? "") ?? entity;
    },
  );

export interface TextHit {
  cik: string;
  name: string;
  matched: string;
  num: string | null;
  context: string;
}

const LEGAL =
  /^,?\s*(?:Inc\.?|Incorporated|Corporation|Corp\.?|Company|Co\.|LLC|L\.L\.C\.|plc|PLC|Ltd\.?|Limited|N\.A\.|Holdings?)\b/u;

const WORD = /[A-Za-z0-9&.'-]+/gu;

export function findNames(sections: TextSection[], companies: Company[], norm: (s: string) => string): TextHit[] {
  const multi = new Map<string, Company[]>();
  const single = new Map<string, Company[]>();

  for (const c of companies) {
    const n = norm(c.name);
    const parts = n.split(" ").filter(Boolean);

    if (!parts.length || parts.every((p) => /^\d+$/u.test(p))) {
      continue;
    }

    const into = parts.length > 1 ? multi : single;

    if (parts.length === 1 && parts.every((p) => p.length < 3)) {
      continue;
    }

    into.set(n, [...(into.get(n) ?? []), c]);
  }

  const maxLen = 6;
  const hits: TextHit[] = [];

  for (const s of sections) {
    const words = [...s.text.matchAll(WORD)].map((m) => ({
      w: m[0],
      at: m.index,
      key: m[0].toUpperCase().replaceAll(/[^A-Z0-9]/gu, ""),
      cap: /^[A-Z0-9]/u.test(m[0]),
    }));

    for (const [i, first] of words.entries()) {
      if (!first.cap) {
        continue;
      }

      for (let len = Math.min(maxLen, words.length - i); len >= 1; len--) {
        const run = words.slice(i, i + len);
        const last = run.at(-1);

        if (last === undefined || !run.every((x) => x.cap)) {
          continue;
        }

        const key = run.flatMap((x) => (x.key ? [x.key] : [])).join(" ");

        const end = last.at + last.w.length;
        const suffixed = LEGAL.test(s.text.slice(end, end + 16));
        const found = len > 1 ? multi.get(key) : suffixed ? single.get(key) : undefined;

        if (!found) {
          continue;
        }

        const next = words[i + len];
        const prev = words[i - 1];
        const runsOn = !suffixed && next?.cap === true && /^\s+$/u.test(s.text.slice(end, next.at));

        const runsIn =
          prev?.cap === true &&
          !/^the$/iu.test(prev.w) &&
          /^\s+$/u.test(s.text.slice(prev.at + prev.w.length, first.at));

        if (runsOn || runsIn) {
          break;
        }

        const matched = s.text.slice(first.at, end);

        const context = s.text
          .slice(Math.max(0, first.at - 220), end + 220)
          .replaceAll(/\s+/gu, " ")
          .trim();

        for (const c of found) {
          hits.push({ cik: c.cik, name: c.name, matched, num: s.num, context });
        }

        break;
      }
    }
  }

  return hits;
}
