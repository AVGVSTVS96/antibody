import { Claim, type ClaimId } from "@antibody/core";
import { CBO_EVEN_SPLIT, COUNTERPART_REF, DOCS } from "./rules.ts";

const ATTENTION_LOCATOR = 'how attention is counted; the counted articles are under "rests on"';

import {
  count,
  day,
  lawNumber,
  type MemberLike,
  memberLabel,
  musd,
  ordinal,
  PARTY,
  quarter,
  quote,
  STATES,
  usd,
} from "./text.ts";

// biome-ignore lint/suspicious/noExplicitAny: rows come from DuckDB shaped by each table's schema, read loosely so a part's new column never breaks wording
export type AnyRow = Record<string, any>;

/** What a template needs to name things: the bill, members, sections, versions, entities. */
export interface Names {
  /** `S.1582 (GENIUS Act)` */
  bill: string;
  /** `S.1582` */
  display: string;
  member(bioguide: string | null | undefined): MemberLike | null;
  section(id: string | null | undefined): { num: string; heading: string } | null;
  version(code: string | null | undefined): string;
  company(id: string): string;
  pac(id: string): string;
  client(key: string): string;
  /** `Akin Gump` / `Visa U.S.A.` / `Q1 2025` for a filing id. */
  filing(id: string): { registrant: string; client: string; when: string } | null;
  committee(id: string): string;
  /** A filing that names this lobbying client, for the client's own claim (lda_clients rows have no source). */
  clientFiling(key: string): string | undefined;
  roll(id: string): string;
  amendment(id: string): string;
  estimate(id: string): AnyRow | null;
  /** Articles found for the bill, and how many of those read were judged to be about it. */
  sample: { found: number; relevant: number };
  /** Today as `YYYY-MM-DD`, to tell a term that is over from one still running. */
  today: string;
}

/** The parts of a claim a template decides; the rest comes from the row (source, rule, confidence, restsOn). */
export interface Wording {
  text: string;
  kind?: "fact" | "inference";
  quote?: string | null;
  rule?: string | null;
  restsOn?: ClaimId[];
  sourceUrl?: string;
  sourceLocator?: string | null;
  confidence?: number;
}

type Template = (row: AnyRow, facet: string | null, n: Names) => Wording;

const who = (n: Names, bioguide: string | null | undefined, fallback = "A member") => {
  const m = n.member(bioguide);
  return m ? memberLabel(m) : fallback;
};
const sec = (n: Names, id: string | null | undefined) => {
  const s = n.section(id);
  return s ? `section ${s.num} (${s.heading ? quote(s.heading, 80) : "no heading"})` : `section ${id}`;
};
const lobbied = (n: Names, filingId: string) => {
  const f = n.filing(filingId);
  return f
    ? `${f.registrant} reported lobbying for ${f.client} in ${f.when}`
    : `Lobbying filing ${filingId} reports lobbying`;
};
/** Whether a bill reference in a filing ("H.R. 29", "S. 394") is a different bill number than the bill's own. */
export function namesAnotherBill(said: string, display: string): boolean {
  const norm = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const own = norm(display);
  const m = norm(said).match(/(HR|S|HJRES|SJRES)(\d+)/);
  return !!m && `${m[1]}${m[2]}` !== own;
}

const secNums = (nums: string[]) =>
  nums.length === 1 ? `section ${nums[0]}` : `sections ${nums.slice(0, -1).join(", ")} and ${nums.at(-1)}`;

/** CBO's sign, worded the same way whichever way it points. */
function cboChange(measure: string, m: number): string {
  const amount = musd(m);
  if (m === 0) return `has no effect on ${measure === "deficit" ? "deficits" : measure.replace("_", " ")}`;
  switch (measure) {
    case "deficit":
      return m > 0 ? `adds ${amount} to deficits` : `reduces deficits by ${amount}`;
    case "revenues":
      return m > 0 ? `raises revenues by ${amount}` : `lowers revenues by ${amount}`;
    case "nonscorable_revenues":
      return `would also raise revenues by ${amount} that CBO does not score, so it is not part of the deficit effect`;
    case "outlays":
      return m > 0 ? `increases outlays by ${amount}` : `decreases outlays by ${amount}`;
    default:
      return m > 0 ? `increases budget authority by ${amount}` : `decreases budget authority by ${amount}`;
  }
}

const OWNER: Record<string, (label: string) => string> = {
  self: (l) => l,
  spouse: (l) => `${l}'s spouse`,
  joint: (l) => `${l} and spouse, jointly,`,
  dependent: (l) => `${l}'s dependent child`,
};
const TRADE_VERB: Record<string, string> = {
  purchase: "bought",
  sale: "sold",
  sale_partial: "sold part of a holding in",
  exchange: "exchanged",
};
const AMENDMENT_STATUS: Record<string, string> = {
  agreed: "was agreed to",
  failed: "failed",
  withdrawn: "was withdrawn",
  no_action: "has no action recorded on congress.gov beyond being submitted",
};

export const TEMPLATES: Record<string, Template> = {
  bills: (r, _f, n) => {
    const name = `${n.display}${r.short_title ? `, the ${r.short_title},` : ""}`;
    if (r.law) return { text: `${name} became Public Law ${lawNumber(r.law)} on ${day(r.law_on)}.` };
    const intro = r.introduced_on ? ` was introduced on ${day(r.introduced_on)}` : " was introduced";
    return { text: `${name}${intro}; latest action: ${r.latest_action ?? "none recorded"}.` };
  },

  versions: (r, facet, n) => {
    const of = r.date ? ` of ${day(r.date)}` : "";
    if (facet === "predecessor")
      return {
        text: `The ${quote(r.name)} text${of} is shown as an earlier stage of ${n.bill}.`,
        kind: "inference",
        rule: r.predecessor_rule,
        restsOn: [`versions/${r.id}`],
        sourceUrl: r.url,
        confidence: 0.9,
      };
    return {
      text: `The ${quote(r.name)} text${of} has ${count(r.sections, "section")} and ${count(r.words, "word")}.`,
    };
  },

  sections: (r, _f, n) => {
    const parts = [
      `Section ${r.num} (${r.heading ? quote(r.heading, 80) : "no heading"}) first appears in the ${n.version(r.first_version)} text`,
    ];
    if (r.split_from) parts.push(`, split out of ${sec(n, r.split_from)}`);
    parts.push(".");
    if (r.changed_in?.length) parts.push(` Its text changes in ${r.changed_in.map(n.version).join(", ")}.`);
    if (r.split_into?.length)
      parts.push(` It is split into ${r.split_into.map((s: string) => sec(n, s)).join(" and ")}.`);
    else if (r.merged_into) parts.push(` It is merged into ${sec(n, r.merged_into)}.`);
    else if (r.removed_in) parts.push(` It is dropped in the ${n.version(r.removed_in)} text.`);
    if (r.revived_in?.length) parts.push(` It returns in ${r.revived_in.map(n.version).join(", ")}.`);
    if (r.in_final) parts.push(" It is in the final text.");
    return { text: parts.join("") };
  },

  sponsorships: (r, _f, n) => ({
    text: `${who(n, r.bioguide)} ${r.role === "sponsor" ? "sponsored" : "cosponsored"} ${n.bill}${r.date ? ` on ${day(r.date)}` : ""}${r.withdrawn_on ? `, and withdrew on ${day(r.withdrawn_on)}` : ""}.`,
  }),

  bill_committees: (r, _f, n) => ({
    text: `${n.bill} was referred to the ${n.committee(r.committee_id)}${r.activity ? ` (${r.activity})` : ""}.`,
  }),

  amendments: (r, _f, n) => {
    const by = r.sponsor_bioguide ? `, offered by ${who(n, r.sponsor_bioguide)},` : "";
    const status = AMENDMENT_STATUS[r.status] ?? `has this latest action: ${r.latest_action ?? "none recorded"}`;
    const on = r.latest_action_on && r.status !== "no_action" ? ` on ${day(r.latest_action_on)}` : "";
    return { text: `${n.amendment(r.id)}${by} ${status}${on}.` };
  },

  amendment_sections: (r, _f, n) => ({
    text: `${n.amendment(r.amendment_id)} is taken to have added or rewritten ${sec(n, r.section_id)}.`,
  }),

  cbo_estimates: (r, facet, n) => {
    if (facet === "mandates")
      return {
        text: `CBO found private-sector mandates: ${r.mandate_private ?? "not stated"}; intergovernmental mandates: ${r.mandate_intergovernmental ?? "not stated"}.`,
      };
    const label = /current.law|current.policy/i.test(r.baseline_label) ? "" : ` (${r.baseline_label})`;
    return { text: `CBO scored ${n.display} (${r.version_scored}) against its ${r.baseline} baseline${label}.` };
  },

  cbo_lines: (r, facet, n) => {
    const base = n.estimate(r.estimate_id)?.baseline ?? "stated";
    const what =
      r.line_kind === "whole-bill"
        ? "the bill"
        : `${secNums(r.section_nums)}${r.title ? ` (${quote(r.title, 80)})` : ""}`;
    if (facet) {
      const share = r.total_musd / Math.max(1, r.section_ids.length);
      return {
        text: `An even share of CBO's line for ${what}: ${sec(n, facet)} ${cboChange(r.measure, share)} over ${r.period} (${base} baseline). CBO did not split this line itself.`,
        kind: "inference",
        rule: CBO_EVEN_SPLIT,
        restsOn: [`cbo_lines/${r.id}`],
        confidence: 0.5,
      };
    }
    return { text: `CBO: ${what} ${cboChange(r.measure, r.total_musd)} over ${r.period} (${base} baseline).` };
  },

  cbo_notes: (r, _f, n) => ({
    text: `CBO wrote on page ${r.page}: ${quote(r.quote, 240)}${r.section_id ? `; taken to be about ${sec(n, r.section_id)}` : ""}.`,
    quote: r.quote,
  }),

  lda_filings: (r) => ({
    text: `${r.registrant_name} filed ${r.form ? `an ${r.form}` : "a lobbying report"} for ${r.client_name} for ${quarter(r.period)} ${r.year}${r.amount_usd != null ? `, reporting ${usd(r.amount_usd)} in ${r.amount_kind ?? "spending"}` : ""}.`,
  }),

  lda_bill_refs: (r, _f, n) => {
    const said = r.matched ? r.matched.replace(/^\W+|[\s,;:.]+$/g, "") : "";
    if (said && namesAnotherBill(said, n.display))
      return {
        text: `${lobbied(n, r.filing_id)} on ${quote(said, 60)}, taken to be ${n.bill} (the other chamber's or an earlier version of the same bill).`,
        kind: "inference",
        rule: COUNTERPART_REF,
        restsOn: [`lda_filings/${r.filing_id}`],
        confidence: 0.8,
        quote: r.quote,
      };
    return {
      text: `${lobbied(n, r.filing_id)} on ${n.bill}${said ? ` (the filing says ${quote(said, 60)})` : ""}.`,
      quote: r.quote,
    };
  },

  lda_topic_refs: (r, _f, n) => ({
    text: `${lobbied(n, r.filing_id)} on ${quote(r.topic, 80)} without naming a bill; taken to be about ${n.bill}.`,
    quote: r.quote,
  }),

  lda_lobbyists: (r, _f, n) => {
    const f = n.filing(r.filing_id);
    const where = f ? ` for ${f.client} through ${f.registrant} in ${f.when}` : "";
    const covered = r.covered_position ? `; covered position as filed: ${quote(r.covered_position, 200)}` : "";
    return { text: `${r.name} lobbied${where}${covered}.`, quote: r.covered_position };
  },

  lda_spend: (r, _facet, n) => {
    const whom = r.client_key ? n.client(r.client_key) : "All clients";
    const amounts =
      r.amounts != null && r.amounts < r.reports
        ? ` ${count(r.reports, "report")} named it and ${r.amounts} gave a dollar amount that is in this total; the other ${r.reports - r.amounts} add $0.`
        : "";
    return {
      text: `${whom} reported ${usd(r.total_usd ?? 0)} in lobbying spending in the ${count(r.quarters, "quarter")} whose filings named ${n.bill}${r.topic_only ? " by topic only" : ""}. That is the filing's total for every issue it lists, not what was spent on this bill.${amounts}`,
      kind: "fact",
      rule: null,
      restsOn: r.total_rests_on ?? [],
      sourceLocator: r.client_key
        ? `the first of the ${count(r.reports, "filing")} this total adds; each one is cited under "rests on"`
        : `the first client's first filing; the total adds ${count(r.reports, "report")} from the clients cited under "rests on"`,
    };
  },

  lda_clients: (r, _f, n) => ({
    text: `${r.name} files as a lobbying client under ${r.names.map((x: string) => quote(x, 80)).join(", ")} (LDA client ${r.lda_client_ids.length > 1 ? "ids" : "id"} ${r.lda_client_ids.join(", ")}).`,
    sourceUrl: n.clientFiling(r.id) ?? `https://lda.gov/api/v1/filings/?client_id=${r.lda_client_ids[0]}`,
  }),

  ptr_documents: (r) => ({
    text: `${r.filer_name} filed a periodic transaction report${r.filed_on ? ` on ${day(r.filed_on)}` : ""}${r.scanned ? " on paper" : ""}; ${r.read_status === "read" ? "it has been read" : r.read_status === "partial" ? "it has been partly read" : "it has not been read yet"}.`,
  }),

  trades: (r, _f, n) => {
    const m = n.member(r.bioguide);
    const label = m ? memberLabel(m) : r.filer_name;
    const asset = String(r.asset).replace(/\s*\[[A-Z]{2}\]\s*$/, "");
    const by = r.read_by === "vision" ? " Read from a scanned page by a vision model." : "";
    return {
      text: `${OWNER[r.owner]!(label)} ${TRADE_VERB[r.type]} ${asset}${r.ticker && !asset.includes(`(${r.ticker})`) ? ` (${r.ticker})` : ""} worth ${r.amount} on ${day(r.traded_on)}.${by}`,
      ...(String(r.source_url).includes("efdsearch.senate.gov") && {
        sourceLocator: `${r.source_locator ?? "the report"}; the Senate site first asks you to accept its terms, then shows the report`,
      }),
    };
  },

  members: (r, facet, n) => {
    const t = facet ? (r.terms as AnyRow[] | undefined)?.find((x) => x.start === facet) : null;
    const m = t ? { party: t.party, state: t.state, district: t.district, chamber: t.chamber } : r;
    const party = PARTY[m.party as "R"] ?? (/^Democrat/.test(m.party) ? "Democratic" : m.party);
    const role = `${/^[AEIOUaeiou]/.test(party) ? "an" : "a"} ${party} ${m.chamber === "Senate" ? "senator" : "representative"}`;
    const where = `${STATES[m.state] ?? m.state}${m.district ? `'s ${ordinal(m.district)} district` : ""}`;
    if (t) {
      const open = String(t.end) >= n.today;
      return {
        text: `${r.name} ${open ? "serves" : "served"} as ${role} from ${where} from ${day(t.start)}${open ? `; the term ends ${day(t.end)}` : ` to ${day(t.end)}`}.`,
      };
    }
    return { text: `${r.name} is ${role} from ${where}.` };
  },

  committees: (r) => ({ text: `The ${r.name} is a ${r.chamber} committee (${r.id}).` }),

  committee_members: (r, _f, n) => ({
    text: `${who(n, r.bioguide)} served on the ${n.committee(r.committee_id)}${r.role ? ` as ${r.role}` : ""} in the ${ordinal(r.congress)} Congress.`,
  }),

  roll_calls: (r) => ({
    text: `On ${day(r.date)} the ${r.chamber} voted ${r.yeas}-${r.nays} on roll call ${r.number}, ${quote(r.question, 120)}: ${r.result}.`,
  }),

  member_votes: (r, _f, n) => ({ text: `${who(n, r.bioguide)} voted ${r.vote} on ${n.roll(r.roll_id)}.` }),

  pacs: (r) => ({
    text: `${r.name} (FEC ${r.id}) is a political committee${r.connected_org ? ` connected to ${r.connected_org}` : ""}.`,
  }),

  contributions: (r, _f, n) => {
    const to = who(n, r.bioguide, `candidate ${r.candidate_id}`);
    const text =
      r.amount_usd < 0
        ? `${to}'s campaign returned ${usd(r.amount_usd)} to ${n.pac(r.pac_id)} on ${day(r.date)}.`
        : `${n.pac(r.pac_id)} gave ${usd(r.amount_usd)} to ${to} on ${day(r.date)}.`;
    return {
      text: text.replace(/^./, (c) => c.toUpperCase()),
      sourceLocator: `FEC filing image, transaction ${r.id}; fec.gov turns away scripts, so open it in a browser`,
    };
  },

  articles: (r) => ({
    text: `${r.outlet_name ?? new URL(r.url).hostname.replace(/^www\./, "")} published ${quote(r.title, 140)}${r.published_on ? ` on ${day(r.published_on)}` : ""}.`,
  }),

  companies: (r) => ({
    text: r.tickers?.length
      ? `${r.name} trades as ${r.tickers.join(", ")} (SEC CIK ${r.id}).`
      : `${r.name} files with the SEC as CIK ${r.id}.`,
    sourceLocator: `SEC EDGAR page for CIK ${r.id} (tickers from SEC's company_tickers_exchange.json); sec.gov turns away scripts, so open it in a browser`,
  }),

  resolutions: (r, _f, n) => {
    const [kind, key] = String(r.src).split(/:(.*)/s) as [string, string];
    const name =
      kind === "pac" ? `The political committee ${quote(n.pac(key))}` : `The lobbying client ${quote(n.client(key))}`;
    return { text: `${name} is taken to be ${n.company(r.company_id)}.` };
  },

  benefits: (r, _f, n) => ({
    text: `${n.company(r.company_id)} is tied to ${r.section_id ? `${sec(n, r.section_id)} of ` : ""}${n.bill} because ${r.basis_rule === "lobbied" ? "it lobbied on it" : "the text names it"}.`,
  }),

  attention: (r, _f, n) => {
    const subject = r.section_id ? sec(n, r.section_id) : `${n.bill} as a whole`;
    const trade = r.trade_legal_hits ? ` Trade and legal press: ${count(r.trade_legal_hits, "more article")}.` : "";
    if (!r.hits)
      return {
        text: `None of the ${n.sample.relevant.toLocaleString("en-US")} relevant articles read (out of ${n.sample.found.toLocaleString("en-US")} found) matched ${subject}. Only a few hundred articles are read, so zero means none among those, not that nobody covered it.${trade}`,
        sourceLocator: ATTENTION_LOCATOR,
        sourceUrl: `${DOCS}#attention-v1`,
      };
    const rank =
      r.pct == null
        ? ""
        : r.pct >= 0.995
          ? ", the most covered section of this bill"
          : r.pct <= 0.005
            ? ", among the least covered sections of this bill"
            : `, more than ${Math.round(r.pct * 100)}% of this bill's other sections`;
    return {
      text: `${r.hits.toLocaleString("en-US")} of the ${n.sample.relevant.toLocaleString("en-US")} relevant articles read (out of ${n.sample.found.toLocaleString("en-US")} found) matched ${subject}${rank}.${trade}`,
      sourceLocator: ATTENTION_LOCATOR,
      sourceUrl: `${DOCS}#attention-v1`,
    };
  },

  counterparts: (r, _f, n) => ({
    text: `${sec(n, r.removed_section_id).replace(/^s/, "S")} is taken to be rewritten as ${sec(n, r.added_section_id)}.`,
  }),

  section_scores: (r, _f, n) => {
    const bits = [
      r.dollars_musd != null
        ? `CBO says it ${r.dollars_musd < 0 ? "cuts" : "adds"} ${musd(r.dollars_musd)} ${r.dollars_musd < 0 ? "from" : "to"} the deficit${r.dollars_split === "even_split" ? " (even split)" : ""}`
        : "no CBO dollars",
      r.attention_pct != null
        ? `attention at the ${ordinal(Math.round(r.attention_pct * 100))} percentile`
        : "attention unmeasured",
      r.late ? "added late" : "not added late",
      r.off_topic != null ? `off-topic distance ${r.off_topic.toFixed(2)}` : null,
      count(r.lobbying_reports, "lobbying report"),
    ].filter(Boolean);
    const score = r.buried != null ? ` (buried score ${r.buried.toFixed(2)})` : "";
    return { text: `${sec(n, r.section_id).replace(/^s/, "S")} is scored ${r.label}${score}: ${bits.join(", ")}.` };
  },
};

/** Tables whose rows are inferences (they carry rule, confidence, rests_on). */
export const INFERENCE_TABLES = new Set([
  "amendment_sections",
  "cbo_notes",
  "lda_topic_refs",
  "lda_spend",
  "resolutions",
  "benefits",
  "attention",
  "counterparts",
  "section_scores",
]);

/** The claim ids a row's claim rests on, before they're checked against the tables. */
export function restsOnOf(table: string, row: AnyRow, facet: string | null, n: Names): ClaimId[] {
  return template(table)(row, facet, n).restsOn ?? row.rests_on ?? [];
}

/**
 * Builds the claim for one row (and facet), filling source, rule and confidence from the row. `restsOn` is the
 * resolved list; an inference without a source of its own takes the source of the first claim it rests on.
 */
export function mintClaim(
  table: string,
  row: AnyRow,
  facet: string | null,
  n: Names,
  restsOn: ClaimId[],
  sourceOf: (ids: ClaimId[]) => string | undefined,
): Claim {
  const w = template(table)(row, facet, n);
  const kind = w.kind ?? (INFERENCE_TABLES.has(table) ? "inference" : "fact");
  return Claim.parse({
    id: `${table}/${row.id}${facet ? `#${facet}` : ""}`,
    text: w.text,
    kind,
    sourceUrl: w.sourceUrl ?? row.source_url ?? row.evidence?.source_url ?? row.evidence?.url ?? sourceOf(restsOn),
    sourceLocator: w.sourceLocator ?? row.source_locator ?? null,
    archiveUrl: row.archive_url ?? null,
    quote: w.quote ?? null,
    confidence: w.confidence ?? row.confidence ?? 1,
    restsOn,
    rule: kind === "inference" ? (w.rule ?? row.rule ?? null) : null,
  });
}

function template(table: string): Template {
  const t = TEMPLATES[table];
  if (!t) throw new Error(`no claim template for ${table}`);
  return t;
}
