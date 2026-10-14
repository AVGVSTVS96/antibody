import { z } from "zod";
import { SourceUrl } from "./claim.ts";

/**
 * DuckDB tables. Each table has one owning package, which writes its rows as JSONL shards to
 * `data/out/<table>/<shard>.jsonl` (via `writeRows` from `@antibody/core/node`); `@antibody/store` loads them.
 * Columns are snake_case. A row's claim id is `<table>/<id>`.
 *
 * Fact rows carry `source_url` + `source_locator`. Inference rows carry `rule`, `confidence`, `rests_on`
 * (claim ids) and `evidence` (method, scores, candidates, the model's reason).
 */

const date = z.iso.date();
const json = z.record(z.string(), z.unknown());
const fact = { source_url: SourceUrl, source_locator: z.string().nullable() };
const inference = {
  rule: z.string(),
  confidence: z.number().min(0).max(1),
  rests_on: z.array(z.string()).min(1),
  evidence: json,
};
const billId = z.string().regex(/^\d+-[a-z]+-\d+$/);
const Party = z.enum(["R", "D", "I"]);
const Chamber = z.enum(["House", "Senate"]);
const Baseline = z.enum(["current-law", "current-policy"]);
const Measure = z.enum(["budget_authority", "outlays", "revenues", "deficit"]);

const table = <S extends z.ZodRawShape>(owner: string, shape: S) => ({
  owner,
  schema: z.strictObject({ id: z.string().min(1), ...shape }),
});

export const TABLES = {
  // ── @antibody/ingest-bills: GovInfo BILLSTATUS + bill XML per version ──
  bills: table("@antibody/ingest-bills", {
    congress: z.number().int(),
    type: z.string(),
    number: z.number().int(),
    title: z.string(),
    short_title: z.string().nullable(),
    sponsor_bioguide: z.string().nullable(),
    introduced_on: date.nullable(),
    policy_area: z.string().nullable(),
    law: z.string().nullable(),
    law_on: date.nullable(),
    latest_action: z.string().nullable(),
    url: z.url(),
    ...fact,
  }),
  versions: table("@antibody/ingest-bills", {
    bill_id: billId,
    code: z.string(),
    name: z.string(),
    date: date.nullable(),
    url: z.url(),
    sections: z.number().int(),
    words: z.number().int(),
    /** A predecessor bill's version (S.394 before S.1582) is an inference stage; its rule says why. */
    predecessor_rule: z.string().nullable(),
    ...fact,
  }),
  sections: table("@antibody/ingest-bills", {
    bill_id: billId,
    num: z.string(),
    heading: z.string(),
    path: z.string(),
    first_version: z.string(),
    in_final: z.boolean(),
    changed_in: z.array(z.string()),
    /** The version where this lineage ends; when `split_into` is non-empty it was split there, not dropped. */
    removed_in: z.string().nullable(),
    revived_in: z.array(z.string()),
    split_from: z.string().nullable(),
    /** Sections later split out of this one (lineage ids). */
    split_into: z.array(z.string()),
    merged_into: z.string().nullable(),
    /**
     * First appears in the first chamber-passed version or later (a floor amendment, the other chamber, conference),
     * and is not just split out of an older section. Lineage only: an LLM counterpart (see `counterparts`) never sets it.
     */
    late: z.boolean(),
    words: z.number().int(),
    text_url: z.url(),
    preview: z.string(),
    /** Per version: path, heading, hash, words, match method, similarity, words added/removed, largest inserts. */
    history: json,
    ...fact,
  }),
  sponsorships: table("@antibody/ingest-bills", {
    bill_id: billId,
    bioguide: z.string(),
    role: z.enum(["sponsor", "cosponsor"]),
    date: date.nullable(),
    withdrawn_on: date.nullable(),
    ...fact,
  }),
  bill_committees: table("@antibody/ingest-bills", {
    bill_id: billId,
    committee_id: z.string(),
    activity: z.string().nullable(),
    ...fact,
  }),
  amendments: table("@antibody/ingest-bills", {
    bill_id: billId,
    number: z.string(),
    chamber: Chamber,
    sponsor_bioguide: z.string().nullable(),
    /** Thomas code when a committee offered it (House Rules Committee substitutes have no member sponsor). */
    sponsor_committee: z.string().nullable(),
    purpose: z.string().nullable(),
    status: z.enum(["agreed", "failed", "withdrawn", "no_action", "other"]),
    latest_action: z.string().nullable(),
    latest_action_on: date.nullable(),
    roll_id: z.string().nullable(),
    version_step: z.string().nullable(),
    url: z.url(),
    ...fact,
  }),
  amendment_sections: table("@antibody/ingest-bills", {
    amendment_id: z.string(),
    section_id: z.string(),
    /** text: the amendment's printed text holds the section; inferred: it's the only agreed amendment that step. */
    how: z.enum(["text", "inferred"]),
    /** inserted becomes an `inserted` edge from the sponsor; struck and changed are shown on the amendment only. */
    effect: z.enum(["inserted", "struck", "changed"]),
    ...inference,
  }),
  /** LLM-paired functional rewrites between a removed and an added section (Senate rewrites of House text). */
  counterparts: table("@antibody/ingest-bills", {
    bill_id: billId,
    removed_section_id: z.string(),
    added_section_id: z.string(),
    ...inference,
  }),

  // ── @antibody/ingest-cbo: CBO estimates, dollars per section ──
  cbo_estimates: table("@antibody/ingest-cbo", {
    bill_id: billId,
    url: z.url(),
    file_url: z.url(),
    archive_url: z.url().nullable(),
    published_on: date.nullable(),
    version_code: z.string().nullable(),
    version_scored: z.string(),
    baseline: Baseline,
    baseline_label: z.string(),
    per_section: z.boolean(),
    mandate_private: z.string().nullable(),
    mandate_intergovernmental: z.string().nullable(),
    ...fact,
  }),
  cbo_lines: table("@antibody/ingest-cbo", {
    estimate_id: z.string(),
    bill_id: billId,
    line_kind: z.enum(["section", "group", "whole-bill"]),
    section_nums: z.array(z.string()),
    section_ids: z.array(z.string()),
    title: z.string().nullable(),
    measure: Measure,
    period: z.string(),
    /** $ millions, sign as CBO prints it. Deficit: positive = adds to the deficit. */
    total_musd: z.number(),
    values: json,
    /** even_split = a CBO group line divided evenly over its sections (CBO never made that split): an inference. */
    split: z.enum(["exact", "even_split"]),
    archive_url: z.url().nullable(),
    /** A derived deficit line rests on the outlay and revenue lines it adds up. */
    rests_on: z.array(z.string()),
    ...fact,
  }),
  cbo_notes: table("@antibody/ingest-cbo", {
    estimate_id: z.string(),
    bill_id: billId,
    section_id: z.string().nullable(),
    quote: z.string(),
    page: z.number().int(),
    ...inference,
  }),

  // ── @antibody/ingest-lobbying: lda.gov LD-2 filings that name a bill ──
  lda_filings: table("@antibody/ingest-lobbying", {
    url: z.url(),
    api_url: z.url(),
    type: z.string(),
    year: z.number().int(),
    period: z.string(),
    posted_at: z.iso.datetime({ offset: true }).nullable(),
    registrant_id: z.string(),
    registrant_name: z.string(),
    client_key: z.string(),
    lda_client_id: z.string(),
    client_name: z.string(),
    client_description: z.string().nullable(),
    amount_usd: z.number().nullable(),
    amount_kind: z.enum(["income", "expenses"]).nullable(),
    ...fact,
  }),
  lda_clients: table("@antibody/ingest-lobbying", {
    name: z.string(),
    lda_client_ids: z.array(z.string()),
    names: z.array(z.string()),
    description: z.string().nullable(),
  }),
  lda_bill_refs: table("@antibody/ingest-lobbying", {
    filing_id: z.string(),
    bill_id: billId,
    section_nums: z.array(z.string()),
    issue_code: z.string(),
    quote: z.string(),
    how: z.enum(["number", "name", "section", "topic"]),
    match: z.enum(["high", "medium", "low"]),
    phase: z.enum(["bill", "enactment-quarter", "law"]),
    ...fact,
  }),
  lda_lobbyists: table("@antibody/ingest-lobbying", {
    filing_id: z.string(),
    lobbyist_id: z.string(),
    name: z.string(),
    /** Quoted exactly as filed. */
    covered_position: z.string().nullable(),
    bill_ids: z.array(billId),
    ...fact,
  }),

  // ── @antibody/ingest-trades: House Clerk PTRs + Senate eFD, vision for paper filings ──
  ptr_documents: table("@antibody/ingest-trades", {
    chamber: Chamber,
    filer_name: z.string(),
    bioguide: z.string().nullable(),
    filed_on: date.nullable(),
    url: z.url(),
    pages: z.number().int().nullable(),
    scanned: z.boolean(),
    read_status: z.enum(["read", "partial", "unread"]),
    read_by: z.enum(["text", "html", "vision"]).nullable(),
    ...fact,
  }),
  trades: table("@antibody/ingest-trades", {
    document_id: z.string(),
    bioguide: z.string().nullable(),
    filer_name: z.string(),
    chamber: Chamber,
    owner: z.enum(["self", "spouse", "joint", "dependent"]),
    asset: z.string(),
    asset_type: z.string().nullable(),
    ticker: z.string().nullable(),
    type: z.enum(["purchase", "sale", "sale_partial", "exchange"]),
    traded_on: date.nullable(),
    notified_on: date.nullable(),
    /** As filed. Dates and amounts are kept as written; *_on are null when the filing's date doesn't parse. */
    amount: z.string(),
    amount_min: z.number().nullable(),
    amount_max: z.number().nullable(),
    page: z.number().int().nullable(),
    read_by: z.enum(["text", "html", "vision"]),
    confidence: z.number().min(0).max(1),
    needs_second_read: z.boolean(),
    raw: json,
    ...fact,
  }),

  // ── @antibody/ingest-members: congress-legislators, committees, roll calls ──
  members: table("@antibody/ingest-members", {
    name: z.string(),
    party: Party,
    state: z.string(),
    district: z.number().int().nullable(),
    chamber: Chamber,
    fec_candidate_ids: z.array(z.string()),
    lis_id: z.string().nullable(),
    ...fact,
  }),
  committees: table("@antibody/ingest-members", {
    name: z.string(),
    chamber: z.enum(["House", "Senate", "Joint"]),
    parent_id: z.string().nullable(),
    url: z.url().nullable(),
    ...fact,
  }),
  committee_members: table("@antibody/ingest-members", {
    committee_id: z.string(),
    bioguide: z.string(),
    role: z.string().nullable(),
    congress: z.number().int(),
    ...fact,
  }),
  roll_calls: table("@antibody/ingest-members", {
    bill_id: billId.nullable(),
    chamber: Chamber,
    congress: z.number().int(),
    session: z.number().int(),
    number: z.number().int(),
    date: date,
    question: z.string(),
    result: z.string(),
    yeas: z.number().int(),
    nays: z.number().int(),
    url: z.url(),
    ...fact,
  }),
  member_votes: table("@antibody/ingest-members", {
    roll_id: z.string(),
    bioguide: z.string(),
    vote: z.enum(["Yea", "Nay", "Present", "Not Voting"]),
    ...fact,
  }),

  // ── @antibody/ingest-fec: FEC bulk PAC → candidate money ──
  pacs: table("@antibody/ingest-fec", {
    name: z.string(),
    connected_org: z.string().nullable(),
    type: z.string().nullable(),
    designation: z.string().nullable(),
    ...fact,
  }),
  contributions: table("@antibody/ingest-fec", {
    pac_id: z.string(),
    bioguide: z.string().nullable(),
    candidate_id: z.string(),
    amount_usd: z.number(),
    date: date,
    cycle: z.number().int(),
    transaction_type: z.string(),
    ...fact,
  }),

  // ── @antibody/ingest-news: Media Cloud + Google News fallback, published outlet list ──
  outlets: table("@antibody/ingest-news", {
    name: z.string(),
    domain: z.string(),
    group: z.enum(["left", "center-left", "center", "center-right", "right", "wire", "tv", "trade-legal"]),
    list_version: z.string(),
    mediacloud_id: z.number().int().nullable(),
  }),
  articles: table("@antibody/ingest-news", {
    bill_id: billId,
    url: z.url(),
    outlet_id: z.string().nullable(),
    title: z.string(),
    published_on: date.nullable(),
    via: z.enum(["mediacloud", "gnews"]),
    text_chars: z.number().int().nullable(),
    ...fact,
  }),

  // ── @antibody/resolve: SEC companies, entity resolution, tied stock ──
  companies: table("@antibody/resolve", {
    name: z.string(),
    tickers: z.array(z.string()),
    exchange: z.string().nullable(),
    sic: z.string().nullable(),
    ...fact,
  }),
  resolutions: table("@antibody/resolve", {
    /** Node id being resolved: client:<key> or pac:<fec id>. */
    src: z.string(),
    company_id: z.string(),
    method: z.string(),
    ...inference,
  }),
  benefits: table("@antibody/resolve", {
    bill_id: billId,
    section_id: z.string().nullable(),
    company_id: z.string(),
    basis_rule: z.enum(["lobbied", "named-in-text"]),
    ...inference,
  }),

  // ── @antibody/analyze: attention, headline vs buried ──
  attention: table("@antibody/analyze", {
    bill_id: billId,
    /** null = the "bill as a whole" bucket, which also feeds the outside-the-text lane. */
    section_id: z.string().nullable(),
    hits: z.number().int(),
    hits_by_group: json,
    trade_legal_hits: z.number().int(),
    pct: z.number().min(0).max(1).nullable(),
    example_article_ids: z.array(z.string()),
    ...inference,
  }),
  section_scores: table("@antibody/analyze", {
    bill_id: billId,
    section_id: z.string(),
    label: z.enum(["headline", "buried", "normal"]),
    buried: z.number().nullable(),
    dollars_musd: z.number().nullable(),
    dollars_split: z.enum(["exact", "even_split"]).nullable(),
    attention_pct: z.number().nullable(),
    late: z.boolean(),
    off_topic: z.number().nullable(),
    lobbying_reports: z.number().int(),
    ...inference,
  }),

  // ── @antibody/watch: the daily watcher ──
  watch_events: table("@antibody/watch", {
    bill_id: billId,
    kind: z.enum(["new_version", "enrolled", "new_bill", "hot"]),
    seen_at: z.iso.datetime({ offset: true }),
    url: z.url(),
    detail: json,
  }),
} as const;

export type TableName = keyof typeof TABLES;
export type Row<T extends TableName> = z.infer<(typeof TABLES)[T]["schema"]>;
export const TABLE_NAMES = Object.keys(TABLES) as TableName[];
