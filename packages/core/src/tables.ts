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
const Measure = z.enum(["budget_authority", "outlays", "revenues", "deficit", "nonscorable_revenues"]);
const Spending = z.enum(["direct", "discretionary"]);

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
    /** Why `sections.late` is withheld for this bill (it began as a shell, or was rewritten wholesale); null when late flags stand. */
    late_unavailable: z.string().nullable().default(null),
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
    /** The estimate's PDF (mandate box, prose that cbo_notes quote by page) and the archive copy we read. */
    pdf_url: z.url().nullable(),
    pdf_archive_url: z.url().nullable(),
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
    /** direct = mandatory spending (counts toward the deficit); discretionary = subject to future appropriation. Null for revenues and deficit. */
    spending: Spending.nullable(),
    period: z.string(),
    /** $ millions, sign as CBO prints it. Deficit: positive = adds to the deficit. */
    total_musd: z.number(),
    values: json,
    /** even_split = a CBO group line divided evenly over its sections (CBO never made that split): an inference. */
    split: z.enum(["exact", "even_split"]),
    /**
     * How CBO's row was tied to the sections. number (or null, rows written before this column): CBO printed the section
     * number and its label matches the section heading. heading: CBO printed no number; the row's label matches
     * exactly one section heading under the division and title it sits in. title: CBO printed the figure for a whole
     * title and the sections are all those under it. heading and title are inferences; the line's source_locator
     * says what they rest on.
     */
    join: z.enum(["number", "heading", "title"]).nullable().default(null),
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

  // ── @antibody/ingest-lobbying: lda.gov LD-1/LD-2 filings that name a bill ──
  /** One row per filing, shared by every bill it names (sharded by filing year). */
  lda_filings: table("@antibody/ingest-lobbying", {
    url: z.url(),
    api_url: z.url(),
    /** LD-1 registration or LD-2 quarterly report; spend and counts use LD-2 only. */
    form: z.enum(["LD-1", "LD-2"]),
    type: z.string(),
    year: z.number().int(),
    period: z.string(),
    period_start: date,
    period_end: date,
    posted_at: z.iso.datetime({ offset: true }).nullable(),
    registrant_id: z.string(),
    registrant_name: z.string(),
    client_key: z.string(),
    lda_client_id: z.string(),
    client_name: z.string(),
    client_description: z.string().nullable(),
    amount_usd: z.number().nullable(),
    amount_kind: z.enum(["income", "expenses"]).nullable(),
    /** Issue lines on the whole filing; the bill-share estimate divides by it. */
    issue_lines: z.number().int(),
    /** A later amendment for the same registrant, client and period replaced it. */
    superseded: z.boolean(),
    ...fact,
  }),
  lda_clients: table("@antibody/ingest-lobbying", {
    name: z.string(),
    lda_client_ids: z.array(z.string()),
    names: z.array(z.string()),
    description: z.string().nullable(),
  }),
  /** One row per issue line that names the bill: `<filing uuid>#<0-based line index>#<bill id>`. */
  lda_bill_refs: table("@antibody/ingest-lobbying", {
    filing_id: z.string(),
    bill_id: billId,
    /** 1-based issue line on the filing. */
    line: z.number().int(),
    section_nums: z.array(z.string()),
    issue_code: z.string(),
    /** The whole issue line, as filed. */
    quote: z.string(),
    /** The words that named the bill, e.g. "S.1582" or "GENIUS Act". */
    matched: z.string(),
    how: z.enum(["number", "name", "public-law"]),
    /** high + medium count as naming the bill; low is held out (another Congress, another bill, before it existed). */
    match: z.enum(["high", "medium", "low"]),
    why: z.string(),
    phase: z.enum(["bill", "enactment-quarter", "law"]),
    ...fact,
  }),
  /** Issue lines that describe the bill's subject without naming any bill: drawn dashed, off by default. */
  lda_topic_refs: table("@antibody/ingest-lobbying", {
    filing_id: z.string(),
    bill_id: billId,
    line: z.number().int(),
    issue_code: z.string(),
    quote: z.string(),
    topic: z.string(),
    phase: z.enum(["bill", "enactment-quarter", "law"]),
    ...fact,
    ...inference,
  }),
  /** One row per filing and lobbyist, quoting the covered (former government) position as filed. */
  lda_lobbyists: table("@antibody/ingest-lobbying", {
    filing_id: z.string(),
    lobbyist_id: z.string(),
    name: z.string(),
    /** Quoted exactly as filed. */
    covered_position: z.string().nullable(),
    /** Members the covered position names, as written ("Rep. David Kustoff"), for resolve to match to bioguide ids. */
    named_members: z.array(z.string()),
    /** Bills named on the issue lines this lobbyist is listed on. */
    bill_ids: z.array(billId),
    ...fact,
  }),
  /**
   * Spend per bill and client (`<bill id>:<client key>`), plus the whole bill (`<bill id>:*`, client_key null).
   * `#total` is a derived fact: the client's reported spend in quarters whose filings named the bill, summed from
   * `total_rests_on`. `#share` is an inference: that total times the share of issue lines naming the bill.
   */
  lda_spend: table("@antibody/ingest-lobbying", {
    bill_id: billId,
    client_key: z.string().nullable(),
    topic_only: z.boolean(),
    reports: z.number().int(),
    quarters: z.number().int(),
    reports_bill: z.number().int(),
    reports_enactment_quarter: z.number().int(),
    reports_law: z.number().int(),
    total_usd: z.number().nullable(),
    share_usd: z.number().nullable(),
    total_rests_on: z.array(z.string()),
    /** The issue line that names the bill most specifically (sections first), for the edge label. */
    issue_quote: z.string().nullable(),
    section_nums: z.array(z.string()),
    ...inference,
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
    /** Every term, oldest first, so a bill can show the party, state and chamber a member had at the time. */
    terms: z.array(
      z.strictObject({
        chamber: Chamber,
        start: date,
        end: date,
        state: z.string(),
        district: z.number().int().nullable(),
        /** As congress-legislators spells it: "Democrat", "Republican", "Independent", "Libertarian". */
        party: z.string(),
        /** The party an independent caucuses with, when the record says. */
        caucus: z.string().nullable(),
      }),
    ),
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
  /** Direct PAC money to a member's campaign: FEC transaction types 24K (cash) and 24Z (in-kind). One row per transaction. */
  contributions: table("@antibody/ingest-fec", {
    pac_id: z.string(),
    bioguide: z.string().nullable(),
    candidate_id: z.string(),
    /** The campaign committee that received it (FEC OTHER_ID); with pac_id it makes the fec.gov link to every such payment. */
    recipient_committee_id: z.string().nullable(),
    amount_usd: z.number(),
    date: date,
    cycle: z.number().int(),
    transaction_type: z.string(),
    ...fact,
  }),
  /** Outside money: a committee's independent expenditure for (24E) or against (24A) a member. Not a contribution. */
  independent_expenditures: table("@antibody/ingest-fec", {
    pac_id: z.string(),
    bioguide: z.string(),
    candidate_id: z.string(),
    support: z.enum(["support", "oppose"]),
    amount_usd: z.number(),
    /** About 1 in 10 independent expenditures in the bulk file carry no date. */
    date: date.nullable(),
    cycle: z.number().int(),
    ...fact,
  }),
  /**
   * Itemized individual contributions to a member's campaign committees, summed per cycle and employer
   * (employer as filed, grouped by a normalized key). Source: FEC bulk indiv file; the URL reproduces the sum on fec.gov.
   */
  employer_contributions: table("@antibody/ingest-fec", {
    bioguide: z.string(),
    cycle: z.number().int(),
    committee_ids: z.array(z.string()).min(1),
    /** The spelling filed most often; `spellings` lists up to 5 by amount. */
    employer: z.string(),
    employer_key: z.string(),
    spellings: z.array(z.string()),
    amount_usd: z.number(),
    contributions: z.number().int(),
    first: date,
    last: date,
    largest_usd: z.number(),
    /** The filing image of the largest single contribution. */
    largest_url: z.url(),
    ...fact,
  }),

  // ── @antibody/ingest-news: Media Cloud + Google News fallback, published outlet list ──
  outlets: table("@antibody/ingest-news", {
    name: z.string(),
    domain: z.string(),
    group: z.enum(["left", "center-left", "center", "center-right", "right", "trade-legal"]),
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
  /** A second look at sections that are costly and look quiet: news passages closest in meaning to the section, judged by a model. */
  attention_checks: table("@antibody/analyze", {
    bill_id: billId,
    section_id: z.string(),
    /** News passages put to the model for this section (one per article, the closest in meaning). */
    passages: z.number().int(),
    /** Articles from counted outlets the model said describe the section that the section matcher had not matched to it. */
    article_ids: z.array(z.string()),
    /** The section's share of the bill's relevant articles with those added (sides weighted equally). */
    share: z.number(),
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
    /** Share of the bill's relevant articles that discuss the section (sides weighted equally); null when the bill's sections are not ranked. */
    attention_share: z.number().nullable().default(null),
    /** Articles the second look added to the section's matcher hits; null when the section was not given one. */
    attention_checked: z.number().int().nullable().default(null),
    late: z.boolean(),
    off_topic: z.number().nullable(),
    lobbying_reports: z.number().int(),
    ...inference,
  }),

  // ── @antibody/watch: the daily watcher ──
  watch_events: table("@antibody/watch", {
    bill_id: billId,
    /** hot = the watcher flagged the bill that day; detail holds its score, sub-scores and reasons. */
    kind: z.enum(["new_version", "enrolled", "new_bill", "floor_vote", "action", "cbo_estimate", "hot"]),
    seen_at: z.iso.datetime({ offset: true }),
    url: z.url(),
    detail: json,
  }),
} as const;

export type TableName = keyof typeof TABLES;
export type Row<T extends TableName> = z.infer<(typeof TABLES)[T]["schema"]>;
export const TABLE_NAMES = Object.keys(TABLES) as TableName[];
