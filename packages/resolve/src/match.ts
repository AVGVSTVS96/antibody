import type { Row } from "@antibody/core";
import { filled } from "@antibody/core";
import { aliasFor } from "./aliases.ts";
import type { Company } from "./edgar.ts";
import { tokenSet, tokenSort, typoClose } from "./fuzzy.ts";
import { CORPORATE, NON_COMPANY, norm, normTicker, parseAsset, tokens } from "./normalize.ts";

export interface Mention {
  src: string;
  source: "client" | "pac" | "employer" | "trade";
  name: string;
  ticker: string | null;
  context: string | null;
  restsOn: string[];
  reviewable?: boolean;
}

export type Evidence = Row<"resolutions">["evidence"];

export type Method = "ticker" | "name_exact" | "fuzzy" | "alias" | "llm_same" | "llm_subsidiary" | "llm_parent";

export interface Match {
  mention: Mention;
  cik: string;
  method: Method;
  confidence: number;
  evidence: Evidence;
}

export interface Candidate {
  cik: string;
  name: string;
  tickers: string[];
  sort: number;
  set: number;
}

export interface Queued {
  mention: Mention;
  normalized: string;
  candidates: Candidate[];
  mayProposeParent: boolean;
  why: string;
}

export type Outcome =
  | { kind: "match"; match: Match }
  | { kind: "queue"; queued: Queued }
  | { kind: "none"; why: string; normalized: string; best: Candidate | null };

export class CompanyIndex {
  readonly byCik = new Map<string, Company>();
  readonly byTicker = new Map<string, Company>();
  private readonly byNorm = new Map<string, Company[]>();
  private readonly byToken = new Map<string, string[]>();
  private readonly idf = new Map<string, number>();
  private readonly maxIdf: number;

  constructor(companies: Company[]) {
    for (const c of companies) {
      this.byCik.set(c.cik, c);

      for (const t of c.tickers) {
        this.byTicker.set(normTicker(t), c);
      }

      const n = norm(c.name);

      if (!n) {
        continue;
      }

      const list = this.byNorm.get(n) ?? [];
      list.push(c);
      this.byNorm.set(n, list);
    }

    for (const n of this.byNorm.keys()) {
      for (const t of new Set(tokens(n))) {
        const list = this.byToken.get(t) ?? [];
        list.push(n);
        this.byToken.set(t, list);
      }
    }

    const total = this.byNorm.size;
    this.maxIdf = Math.log(total + 1);

    for (const [t, list] of this.byToken) {
      this.idf.set(t, Math.log((total + 1) / list.length));
    }
  }

  exact(normalized: string): Company[] {
    return this.byNorm.get(normalized) ?? [];
  }

  candidates(normalized: string, limit = 6): Candidate[] {
    const ts = [...new Set(tokens(normalized))];
    const weight = (t: string) => this.idf.get(t) ?? this.maxIdf;
    const total = ts.reduce((s, t) => s + weight(t), 0);
    const overlap = new Map<string, number>();

    for (const t of ts) {
      for (const n of this.byToken.get(t) ?? []) {
        overlap.set(n, (overlap.get(n) ?? 0) + weight(t) / total);
      }
    }

    const pool = [...overlap].toSorted((a, b) => b[1] - a[1]).slice(0, 40);

    const scored = pool.flatMap(([n]) =>
      (this.byNorm.get(n) ?? []).map((c) => ({
        cik: c.cik,
        name: c.name,
        tickers: c.tickers,
        sort: round(tokenSort(normalized, n)),
        set: round(tokenSet(normalized, n)),
      })),
    );

    const bySort = scored.toSorted((a, b) => b.sort - a.sort);
    const bySet = scored.toSorted((a, b) => b.set - a.set);
    const picked = new Map<string, Candidate>();

    for (let i = 0; picked.size < limit && i < scored.length; i++) {
      for (const c of [bySort[i], bySet[i]]) {
        if (c && picked.size < limit) {
          picked.set(c.cik, c);
        }
      }
    }

    return [...picked.values()];
  }
}

const round = (x: number) => Math.round(x * 10) / 10;

function namesAgree(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);

  if (!na || !nb) {
    return true;
  }

  return tokenSet(na, nb) >= 60 || tokens(na)[0] === tokens(nb)[0];
}

export function resolveMention(m: Mention, index: CompanyIndex): Outcome {
  const asset = m.source === "trade" ? parseAsset(m.name) : null;
  const raw = asset ? asset.name : m.name;
  const ticker = asset ? (m.ticker ?? asset.ticker) : null;
  const normalized = norm(raw);

  if (filled(ticker)) {
    const c = index.byTicker.get(normTicker(ticker));

    if (c && namesAgree(raw, c.name)) {
      return match(m, c.cik, "ticker", 0.99, { ticker, edgarName: c.name, filedName: raw });
    }

    if (c) {
      const cands = [toCandidate(c, normalized), ...index.candidates(normalized).filter((x) => x.cik !== c.cik)];

      return queue(m, normalized, cands, false, `ticker ${ticker} is ${c.name}, which doesn't match the filed name`);
    }
  }

  if (!normalized) {
    return { kind: "none", why: "nothing left after removing legal and filler words", normalized, best: null };
  }

  const alias = m.source === "trade" ? undefined : aliasFor(normalized);

  if (alias && index.byCik.has(alias.cik)) {
    return match(m, alias.cik, "alias", 0.95, { normalized, reason: alias.why });
  }

  const exact = index.exact(normalized);
  const single = tokens(normalized).length === 1;

  const [only] = exact;

  if (exact.length === 1 && only !== undefined && !single) {
    return match(m, only.cik, "name_exact", 0.95, { normalized, edgarName: only.name });
  }

  const cands = index.candidates(normalized);

  if (exact.length) {
    const others = cands.filter((c) => !exact.some((e) => e.cik === c.cik));
    const why = exact.length > 1 ? `${exact.length} SEC companies share this name` : "one-word name";

    return queue(m, normalized, [...exact.map((e) => toCandidate(e, normalized)), ...others], canPropose(m), why);
  }

  const bySort = cands.toSorted((a, b) => b.sort - a.sort);
  const best = bySort[0] ?? null;
  const margin = best ? best.sort - (bySort[1]?.sort ?? 0) : 0;
  const sameHead = best ? tokens(norm(best.name))[0] === tokens(normalized)[0] : false;

  if (best && !single && best.sort >= 94 && margin >= 4 && sameHead && typoClose(normalized, norm(best.name))) {
    return match(m, best.cik, "fuzzy", 0.9, { normalized, score: best.sort, margin, candidates: cands });
  }

  const bestSet = Math.max(0, ...cands.map((c) => c.set));
  const plausible = sameHead && best !== null && (best.sort >= 75 || bestSet >= 90);

  if (m.source !== "trade" && NON_COMPANY.test(raw.toUpperCase()) && bestSet < 85) {
    return {
      kind: "none",
      why: "reads as an association, government or school, and no SEC name is close",
      normalized,
      best,
    };
  }

  if (plausible) {
    return queue(m, normalized, cands, canPropose(m), "a close SEC name needs a judgment call");
  }

  if (canPropose(m)) {
    return queue(m, normalized, cands, true, "a business with no close SEC name: maybe a subsidiary");
  }

  return { kind: "none", why: "no close SEC name", normalized, best };
}

function canPropose(m: Mention): boolean {
  return (
    (m.source === "client" || m.source === "pac") && CORPORATE.test(m.name) && !NON_COMPANY.test(m.name.toUpperCase())
  );
}

function toCandidate(c: Company, normalized: string): Candidate {
  const n = norm(c.name);

  return {
    cik: c.cik,
    name: c.name,
    tickers: c.tickers,
    sort: round(tokenSort(normalized, n)),
    set: round(tokenSet(normalized, n)),
  };
}

const match = (mention: Mention, cik: string, method: Method, confidence: number, evidence: Evidence): Outcome => ({
  kind: "match",
  match: { mention, cik, method, confidence, evidence },
});

function queue(
  mention: Mention,
  normalized: string,
  candidates: Candidate[],
  mayProposeParent: boolean,
  why: string,
): Outcome {
  if (mention.reviewable === false) {
    return { kind: "none", why: `not reviewed (${why})`, normalized, best: candidates[0] ?? null };
  }

  return { kind: "queue", queued: { mention, normalized, candidates, mayProposeParent, why } };
}
