import type { Company } from "./edgar.ts";
import { tokenSet, tokenSort } from "./fuzzy.ts";
import { assetName, CORPORATE, NON_COMPANY, norm, normTicker, tickerInAsset, tokens } from "./normalize.ts";

/** One organization name found in a record, to be resolved to an SEC company. */
export interface Mention {
  /** What is being resolved: client:<key>, pac:<FEC id>, employer:<employer key>, trade:<trades row id>. Also the resolution row id. */
  src: string;
  source: "client" | "pac" | "employer" | "trade";
  name: string;
  /** Only PTR lines carry a ticker; lobbying and PAC names never do ("(EPC)" there is an acronym). */
  ticker: string | null;
  /** Shown to the reviewer: the PAC's name, the client's self-description. */
  context: string | null;
  /** Claim ids of the record the name comes from. */
  restsOn: string[];
  /** False keeps a name out of model review (small donor employers): only deterministic matches count for it. */
  reviewable?: boolean;
}

export type Method = "ticker" | "name_exact" | "fuzzy" | "llm_same" | "llm_subsidiary" | "llm_parent";

export interface Match {
  mention: Mention;
  cik: string;
  method: Method;
  confidence: number;
  evidence: Record<string, unknown>;
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
  /** Lobbying clients and corporate PACs may be a subsidiary of a parent outside the candidates. */
  mayProposeParent: boolean;
  why: string;
}

export type Outcome =
  | { kind: "match"; match: Match }
  | { kind: "queue"; queued: Queued }
  | { kind: "none"; why: string; normalized: string; best: Candidate | null };

/** SEC companies indexed by ticker, normalized name, and name token (with IDF weights) for candidate lookup. */
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
      for (const t of c.tickers) this.byTicker.set(normTicker(t), c);
      const n = norm(c.name);
      if (!n) continue;
      const list = this.byNorm.get(n) ?? [];
      list.push(c);
      this.byNorm.set(n, list);
    }
    for (const n of this.byNorm.keys())
      for (const t of new Set(tokens(n))) {
        const list = this.byToken.get(t) ?? [];
        list.push(n);
        this.byToken.set(t, list);
      }
    const total = this.byNorm.size;
    this.maxIdf = Math.log(total + 1);
    for (const [t, list] of this.byToken) this.idf.set(t, Math.log((total + 1) / list.length));
  }

  exact(normalized: string): Company[] {
    return this.byNorm.get(normalized) ?? [];
  }

  /** Up to `limit` SEC names sharing the rarest words with `normalized`, scored token-sort and token-set. */
  candidates(normalized: string, limit = 6): Candidate[] {
    const ts = [...new Set(tokens(normalized))];
    const weight = (t: string) => this.idf.get(t) ?? this.maxIdf;
    const total = ts.reduce((s, t) => s + weight(t), 0);
    const overlap = new Map<string, number>();
    for (const t of ts)
      for (const n of this.byToken.get(t) ?? []) overlap.set(n, (overlap.get(n) ?? 0) + weight(t) / total);
    const pool = [...overlap].sort((a, b) => b[1] - a[1]).slice(0, 40);
    const scored = pool.flatMap(([n]) =>
      this.byNorm.get(n)!.map((c) => ({
        cik: c.cik,
        name: c.name,
        tickers: c.tickers,
        sort: round(tokenSort(normalized, n)),
        set: round(tokenSet(normalized, n)),
      })),
    );
    const bySort = [...scored].sort((a, b) => b.sort - a.sort);
    const bySet = [...scored].sort((a, b) => b.set - a.set);
    const picked = new Map<string, Candidate>();
    for (let i = 0; picked.size < limit && i < scored.length; i++)
      for (const c of [bySort[i], bySet[i]]) if (c && picked.size < limit) picked.set(c.cik, c);
    return [...picked.values()];
  }
}

const round = (x: number) => Math.round(x * 10) / 10;

/** Ticker names that agree, loosely: a PTR's "Alphabet Inc. - Class A" against EDGAR's "Alphabet Inc.". */
function namesAgree(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return true;
  return tokenSet(na, nb) >= 60 || tokens(na)[0] === tokens(nb)[0];
}

/**
 * Deterministic keys first, then fuzzy, then the review queue. Accepts only what needs no judgment:
 * a disclosed ticker whose company name agrees, a unique multi-word normalized name, or a near-identical name
 * with a clear margin and the same first word. Everything plausible but uncertain goes to review with candidates.
 */
export function resolveMention(m: Mention, index: CompanyIndex): Outcome {
  const raw = m.source === "trade" ? assetName(m.name) : m.name;
  const ticker = m.source === "trade" ? (m.ticker ?? tickerInAsset(m.name)) : null;
  const normalized = norm(raw);

  if (ticker) {
    const c = index.byTicker.get(normTicker(ticker));
    if (c && namesAgree(raw, c.name))
      return match(m, c.cik, "ticker", 0.99, { ticker, edgarName: c.name, filedName: raw });
    if (c) {
      const cands = [toCandidate(c, normalized), ...index.candidates(normalized).filter((x) => x.cik !== c.cik)];
      return queue(m, normalized, cands, false, `ticker ${ticker} is ${c.name}, which doesn't match the filed name`);
    }
  }
  if (!normalized)
    return { kind: "none", why: "nothing left after removing legal and filler words", normalized, best: null };

  const exact = index.exact(normalized);
  const single = tokens(normalized).length === 1;
  if (exact.length === 1 && !single)
    return match(m, exact[0]!.cik, "name_exact", 0.95, { normalized, edgarName: exact[0]!.name });

  const cands = index.candidates(normalized);
  if (exact.length) {
    const others = cands.filter((c) => !exact.some((e) => e.cik === c.cik));
    const why = exact.length > 1 ? `${exact.length} SEC companies share this name` : "one-word name";
    return queue(m, normalized, [...exact.map((e) => toCandidate(e, normalized)), ...others], canPropose(m), why);
  }

  const bySort = [...cands].sort((a, b) => b.sort - a.sort);
  const best = bySort[0] ?? null;
  const margin = best ? best.sort - (bySort[1]?.sort ?? 0) : 0;
  const sameHead = best ? tokens(norm(best.name))[0] === tokens(normalized)[0] : false;
  if (best && !single && best.sort >= 94 && margin >= 4 && sameHead)
    return match(m, best.cik, "fuzzy", 0.9, { normalized, score: best.sort, margin, candidates: cands });

  const bestSet = Math.max(0, ...cands.map((c) => c.set));
  const plausible = sameHead && best !== null && (best.sort >= 75 || bestSet >= 90);
  if (m.source !== "trade" && NON_COMPANY.test(raw.toUpperCase()) && bestSet < 85)
    return {
      kind: "none",
      why: "reads as an association, government or school, and no SEC name is close",
      normalized,
      best,
    };
  if (plausible) return queue(m, normalized, cands, canPropose(m), "a close SEC name needs a judgment call");
  if (canPropose(m)) return queue(m, normalized, cands, true, "a business with no close SEC name: maybe a subsidiary");
  return { kind: "none", why: "no close SEC name", normalized, best };
}

/** A lobbying client or PAC sponsor whose name is plainly a business may be a subsidiary of a public parent. */
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

const match = (
  mention: Mention,
  cik: string,
  method: Method,
  confidence: number,
  evidence: Record<string, unknown>,
): Outcome => ({
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
  if (mention.reviewable === false)
    return { kind: "none", why: `not reviewed (${why})`, normalized, best: candidates[0] ?? null };
  return { kind: "queue", queued: { mention, normalized, candidates, mayProposeParent, why } };
}
