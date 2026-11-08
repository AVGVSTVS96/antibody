import { filled, Claim, REACH_WORDS } from "@antibody/core";
import type { ClaimId, Row, TableName } from "@antibody/core";
import { isText } from "./db.ts";
import { CBO_EVEN_SPLIT, CBO_HEADING_JOIN, COUNTERPART_REF, DOCS } from "./rules.ts";
import { count, day, lawNumber, memberLabel, musd, ordinal, PARTY, quarter, quote, stateName, usd } from "./text.ts";
import type { MemberLike } from "./text.ts";

const ATTENTION_LOCATOR = 'how attention is counted; the counted articles are under "rests on"';

export type Term = Row<"members">["terms"][number];

interface Joined {
  articles: { outlet_name?: string | null };
  lda_spend: { amounts?: number };
  members: { term?: Term };
}

export type CitedRow<T extends TableName> = Row<T> & (T extends keyof Joined ? Joined[T] : object);

export type Member = CitedRow<"members">;

export const missing = (v: string | number | null | undefined): v is null | undefined => v === null || v === undefined;

export interface Names {
  bill: string;
  display: string;
  member: (bioguide: string | null | undefined) => MemberLike | null;
  section: (id: string | null | undefined) => { num: string; heading: string } | null;
  version: (code: string | null | undefined) => string;
  company: (id: string) => string;
  pac: (id: string) => string;
  client: (key: string) => string;
  filing: (id: string) => { registrant: string; client: string; when: string } | null;
  committee: (id: string) => string;
  clientFilingUrl: (key: string) => string | undefined;
  roll: (id: string) => string;
  amendment: (id: string) => string;
  estimate: (id: string) => Row<"cbo_estimates"> | null;
  sample: { found: number; relevant: number };
  today: string;
}

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

type Template<T extends TableName> = (row: CitedRow<T>, facet: string | null, n: Names) => Wording;

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

const billNumberKey = (x: string) => x.toUpperCase().replaceAll(/[^A-Z0-9]/gu, "");

export function namesAnotherBill(said: string, display: string): boolean {
  const own = billNumberKey(display);
  const m = /(HR|S|HJRES|SJRES)(\d+)/u.exec(billNumberKey(said));

  return m !== null && `${m[1]}${m[2]}` !== own;
}

const secNums = (nums: string[]) =>
  nums.length === 1 ? `section ${nums[0]}` : `sections ${nums.slice(0, -1).join(", ")} and ${nums.at(-1)}`;

function cboChange(measure: string, m: number): string {
  const amount = musd(m);

  if (m === 0) {
    return `has no effect on ${measure === "deficit" ? "deficits" : measure.replace("_", " ")}`;
  }

  switch (measure) {
    case "deficit": {
      return m > 0 ? `adds ${amount} to deficits` : `reduces deficits by ${amount}`;
    }

    case "revenues": {
      return m > 0 ? `raises revenues by ${amount}` : `lowers revenues by ${amount}`;
    }

    case "nonscorable_revenues": {
      return `would also raise revenues by ${amount} that CBO does not score, so it is not part of the deficit effect`;
    }

    case "outlays": {
      return m > 0 ? `increases outlays by ${amount}` : `decreases outlays by ${amount}`;
    }

    default: {
      return m > 0 ? `increases budget authority by ${amount}` : `decreases budget authority by ${amount}`;
    }
  }
}

const OWNER: Record<Row<"trades">["owner"], (label: string) => string> = {
  self: (l) => l,
  spouse: (l) => `${l}'s spouse`,
  joint: (l) => `${l} and spouse, jointly,`,
  dependent: (l) => `${l}'s dependent child`,
};

const TRADE_VERB: Record<Row<"trades">["type"], string> = {
  purchase: "bought",
  sale: "sold",
  sale_partial: "sold part of a holding in",
  exchange: "exchanged",
};

const AMENDMENT_STATUS: Partial<Record<Row<"amendments">["status"], string>> = {
  agreed: "was agreed to",
  failed: "failed",
  withdrawn: "was withdrawn",
  no_action: "has no action recorded on congress.gov beyond being submitted",
};

const PARTY_NAME = new Map<string, string>(Object.entries(PARTY));

const baseName = (b: string) => (b === "current-policy" ? "current policy" : "current law");

interface BaselineDollars {
  baseline: string;
  musd: number;
}

const isBaselineDollars = (v: unknown): v is BaselineDollars =>
  typeof v === "object" &&
  v !== null &&
  "baseline" in v &&
  typeof v.baseline === "string" &&
  "musd" in v &&
  typeof v.musd === "number";

const scoreEvidence = (e: Row<"section_scores">["evidence"]) => ({
  dollarsBaseline: isText(e.dollars_baseline) ? e.dollars_baseline : null,
  dollarsByBaseline: Array.isArray(e.dollars_by_baseline) ? e.dollars_by_baseline.filter(isBaselineDollars) : [],
});

type Templates = { [T in TableName]?: Template<T> };

export const TEMPLATES = {
  bills: (r, _f, n) => {
    const name = `${n.display}${filled(r.short_title) ? `, the ${r.short_title},` : ""}`;

    if (filled(r.law)) {
      return { text: `${name} became Public Law ${lawNumber(r.law)} on ${day(r.law_on)}.` };
    }

    const intro = filled(r.introduced_on) ? ` was introduced on ${day(r.introduced_on)}` : " was introduced";

    return { text: `${name}${intro}; latest action: ${r.latest_action ?? "none recorded"}.` };
  },

  versions: (r, facet, n) => {
    const of = filled(r.date) ? ` of ${day(r.date)}` : "";

    if (facet === "predecessor") {
      return {
        text: `The ${quote(r.name)} text${of} is shown as an earlier stage of ${n.bill}.`,
        kind: "inference",
        rule: r.predecessor_rule,
        restsOn: [`versions/${r.id}`],
        sourceUrl: r.url,
        confidence: 0.9,
      };
    }

    return {
      text: `The ${quote(r.name)} text${of} has ${count(r.sections, "section")} and ${count(r.words, "word")}.`,
    };
  },

  sections: (r, _f, n) => {
    const parts = [
      `Section ${r.num} (${filled(r.heading) ? quote(r.heading, 80) : "no heading"}) first appears in the ${n.version(r.first_version)} text`,
    ];

    if (filled(r.split_from)) {
      parts.push(`, split out of ${sec(n, r.split_from)}`);
    }

    parts.push(".");

    if (r.changed_in.length > 0) {
      parts.push(` Its text changes in ${r.changed_in.map((v) => n.version(v)).join(", ")}.`);
    }

    if (r.split_into.length > 0) {
      parts.push(` It is split into ${r.split_into.map((s) => sec(n, s)).join(" and ")}.`);
    } else if (filled(r.merged_into)) {
      parts.push(` It is merged into ${sec(n, r.merged_into)}.`);
    } else if (filled(r.removed_in)) {
      parts.push(` It is dropped in the ${n.version(r.removed_in)} text.`);
    }

    if (r.revived_in.length > 0) {
      parts.push(` It returns in ${r.revived_in.map((v) => n.version(v)).join(", ")}.`);
    }

    if (r.in_final) {
      parts.push(" It is in the final text.");
    }

    return { text: parts.join("") };
  },

  section_parts: (r, _f, n) => {
    const late = r.late ? ", after a chamber had passed the bill, so it was added late" : "";

    const first =
      r.first_version === r.version
        ? ` It is new in that text${late}.`
        : ` It first appears in the ${n.version(r.first_version)} text (the earliest with at least half its wording)${late}.`;

    return {
      text: `Section ${r.num} (${filled(r.heading) ? quote(r.heading, 80) : r.lead_in ? "its opening words" : "no heading"}) is ${count(r.words, "word")} of ${sec(n, r.section_id)} in the ${n.version(r.version)} text.${first}`,
    };
  },

  sponsorships: (r, _f, n) => ({
    text: `${who(n, r.bioguide)} ${r.role === "sponsor" ? "sponsored" : "cosponsored"} ${n.bill}${filled(r.date) ? ` on ${day(r.date)}` : ""}${filled(r.withdrawn_on) ? `, and withdrew on ${day(r.withdrawn_on)}` : ""}.`,
  }),

  bill_committees: (r, _f, n) => ({
    text: `${n.bill} was referred to the ${n.committee(r.committee_id)}${filled(r.activity) ? ` (${r.activity})` : ""}.`,
  }),

  amendments: (r, _f, n) => {
    const by = filled(r.sponsor_bioguide) ? `, offered by ${who(n, r.sponsor_bioguide)},` : "";
    const status = AMENDMENT_STATUS[r.status] ?? `has this latest action: ${r.latest_action ?? "none recorded"}`;
    const on = filled(r.latest_action_on) && r.status !== "no_action" ? ` on ${day(r.latest_action_on)}` : "";

    return { text: `${n.amendment(r.id)}${by} ${status}${on}.` };
  },

  amendment_sections: (r, _f, n) => ({
    text: `${n.amendment(r.amendment_id)} is taken to have added or rewritten ${sec(n, r.section_id)}.`,
  }),

  cbo_estimates: (r, facet, n) => {
    if (facet === "mandates") {
      return {
        text: `CBO found private-sector mandates: ${r.mandate_private ?? "not stated"}; intergovernmental mandates: ${r.mandate_intergovernmental ?? "not stated"}.`,
      };
    }

    const label = /current.law|current.policy/iu.test(r.baseline_label) ? "" : ` (${r.baseline_label})`;

    return { text: `CBO scored ${n.display} (${r.version_scored}) against its ${r.baseline} baseline${label}.` };
  },

  cbo_lines: (r, facet, n) => {
    const base = n.estimate(r.estimate_id)?.baseline ?? "stated";

    const what =
      r.line_kind === "whole-bill"
        ? "the bill"
        : `${secNums(r.section_nums)}${filled(r.title) ? ` (${quote(r.title, 80)})` : ""}`;

    if (filled(facet)) {
      const share = r.total_musd / Math.max(1, r.section_ids.length);

      return {
        text: `An even share of CBO's line for ${what}: ${sec(n, facet)} ${cboChange(r.measure, share)} over ${r.period} (${base} baseline). CBO did not split this line itself.`,
        kind: "inference",
        rule: CBO_EVEN_SPLIT,
        restsOn: [`cbo_lines/${r.id}`],
        confidence: 0.5,
      };
    }

    const [only] = r.section_ids;
    const tied = r.section_ids.length === 1 && (r.join === "heading" || r.join === "title") ? (only ?? null) : null;

    if (filled(tied)) {
      return {
        text: `CBO: ${what} ${cboChange(r.measure, r.total_musd)} over ${r.period} (${base} baseline). CBO printed no section number; the row is tied to ${sec(n, tied)} ${r.join === "heading" ? "because its label matches that section's heading" : "because it is the only section under the title the figure covers"}.`,
        kind: "inference",
        rule: CBO_HEADING_JOIN,
        restsOn: [`sections/${tied}`],
        confidence: 0.8,
      };
    }

    return { text: `CBO: ${what} ${cboChange(r.measure, r.total_musd)} over ${r.period} (${base} baseline).` };
  },

  cbo_notes: (r, _f, n) => ({
    text: `CBO wrote on page ${r.page}: ${quote(r.quote, 240)}${filled(r.section_id) ? `; taken to be about ${sec(n, r.section_id)}` : ""}.`,
    quote: r.quote,
  }),

  lda_filings: (r) => ({
    text: `${r.registrant_name} filed ${filled(r.form) ? `an ${r.form}` : "a lobbying report"} for ${r.client_name} for ${quarter(r.period)} ${r.year}${missing(r.amount_usd) ? "" : `, reporting ${usd(r.amount_usd)} in ${r.amount_kind ?? "spending"}`}.`,
  }),

  lda_bill_refs: (r, _f, n) => {
    const said = filled(r.matched) ? r.matched.replaceAll(/^\W+|[\s,;:.]+$/gu, "") : "";

    if (said !== "" && namesAnotherBill(said, n.display)) {
      return {
        text: `${lobbied(n, r.filing_id)} on ${quote(said, 60)}, taken to be ${n.bill} (the other chamber's or an earlier version of the same bill).`,
        kind: "inference",
        rule: COUNTERPART_REF,
        restsOn: [`lda_filings/${r.filing_id}`],
        confidence: 0.8,
        quote: r.quote,
      };
    }

    return {
      text: `${lobbied(n, r.filing_id)} on ${n.bill}${said === "" ? "" : ` (the filing says ${quote(said, 60)})`}.`,
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
    const covered = filled(r.covered_position) ? `; covered position as filed: ${quote(r.covered_position, 200)}` : "";

    return { text: `${r.name} lobbied${where}${covered}.`, quote: r.covered_position };
  },

  lda_spend: (r, _facet, n) => {
    const whom = filled(r.client_key) ? n.client(r.client_key) : "All clients";

    const amounts =
      !missing(r.amounts) && r.amounts < r.reports
        ? ` ${count(r.reports, "report")} named it and ${r.amounts} gave a dollar amount that is in this total; the other ${r.reports - r.amounts} add $0.`
        : "";

    return {
      text: `${whom} reported ${usd(r.total_usd ?? 0)} in lobbying spending in the ${count(r.quarters, "quarter")} whose filings named ${n.bill}${r.topic_only ? " by topic only" : ""}. That is the filing's total for every issue it lists, not what was spent on this bill.${amounts}`,
      kind: "fact",
      rule: null,
      restsOn: r.total_rests_on,
      sourceLocator: filled(r.client_key)
        ? `the first of the ${count(r.reports, "filing")} this total adds; each one is cited under "rests on"`
        : `the first client's first filing; the total adds ${count(r.reports, "report")} from the clients cited under "rests on"`,
    };
  },

  lda_clients: (r, _f, n) => ({
    text: `${r.name} files as a lobbying client under ${r.names.map((x) => quote(x, 80)).join(", ")} (LDA client ${r.lda_client_ids.length > 1 ? "ids" : "id"} ${r.lda_client_ids.join(", ")}).`,
    sourceUrl: n.clientFilingUrl(r.id) ?? `https://lda.gov/api/v1/filings/?client_id=${r.lda_client_ids[0]}`,
  }),

  ptr_documents: (r) => ({
    text: `${r.filer_name} filed a periodic transaction report${filled(r.filed_on) ? ` on ${day(r.filed_on)}` : ""}${r.scanned ? " on paper" : ""}; ${r.read_status === "read" ? "it has been read" : r.read_status === "partial" ? "it has been partly read" : "it has not been read yet"}.`,
  }),

  trades: (r, _f, n) => {
    const m = n.member(r.bioguide);
    const label = m ? memberLabel(m) : r.filer_name;
    const asset = r.asset.replace(/\s*\[[A-Z]{2}\]\s*$/u, "");
    const by = r.read_by === "vision" ? " Read from a scanned page by a vision model." : "";

    return {
      text: `${OWNER[r.owner](label)} ${TRADE_VERB[r.type]} ${asset}${filled(r.ticker) && !asset.includes(`(${r.ticker})`) ? ` (${r.ticker})` : ""} worth ${r.amount} on ${day(r.traded_on)}.${by}`,
      ...(r.source_url.includes("efdsearch.senate.gov") && {
        sourceLocator: `${r.source_locator ?? "the report"}; the Senate site first asks you to accept its terms, then shows the report`,
      }),
    };
  },

  members: (r, facet, n) => {
    const t = filled(facet) ? r.terms.find((x) => x.start === facet) : undefined;
    const m = t ?? r;
    const party = PARTY_NAME.get(m.party) ?? (m.party.startsWith("Democrat") ? "Democratic" : m.party);
    const role = `${/^[AEIOUaeiou]/u.test(party) ? "an" : "a"} ${party} ${m.chamber === "Senate" ? "senator" : "representative"}`;
    const where = `${stateName(m.state)}${missing(m.district) || m.district === 0 ? "" : `'s ${ordinal(m.district)} district`}`;

    if (t) {
      const open = t.end >= n.today;

      return {
        text: `${r.name} ${open ? "serves" : "served"} as ${role} from ${where} from ${day(t.start)}${open ? `; the term ends ${day(t.end)}` : ` to ${day(t.end)}`}.`,
      };
    }

    return { text: `${r.name} is ${role} from ${where}.` };
  },

  committees: (r) => ({ text: `The ${r.name} is a ${r.chamber} committee (${r.id}).` }),

  committee_members: (r, _f, n) => ({
    text: `${who(n, r.bioguide)} served on the ${n.committee(r.committee_id)}${filled(r.role) ? ` as ${r.role}` : ""} in the ${ordinal(r.congress)} Congress.`,
  }),

  roll_calls: (r) => ({
    text: `On ${day(r.date)} the ${r.chamber} voted ${r.yeas}-${r.nays} on roll call ${r.number}, ${quote(r.question, 120)}: ${r.result}.`,
  }),

  member_votes: (r, _f, n) => ({ text: `${who(n, r.bioguide)} voted ${r.vote} on ${n.roll(r.roll_id)}.` }),

  pacs: (r) => ({
    text: `${r.name} (FEC ${r.id}) is a political committee${filled(r.connected_org) ? ` connected to ${r.connected_org}` : ""}.`,
  }),

  contributions: (r, _f, n) => {
    const to = who(n, r.bioguide, `candidate ${r.candidate_id}`);

    const text =
      r.amount_usd < 0
        ? `${to}'s campaign returned ${usd(r.amount_usd)} to ${n.pac(r.pac_id)} on ${day(r.date)}.`
        : `${n.pac(r.pac_id)} gave ${usd(r.amount_usd)} to ${to} on ${day(r.date)}.`;

    return {
      text: text.replace(/^./u, (c) => c.toUpperCase()),
      sourceLocator: `FEC filing image, transaction ${r.id}; fec.gov turns away scripts, so open it in a browser`,
    };
  },

  articles: (r) => ({
    text: `${r.outlet_name ?? new URL(r.url).hostname.replace(/^www\./u, "")} published ${quote(r.title, 140)}${filled(r.published_on) ? ` on ${day(r.published_on)}` : ""}.`,
  }),

  companies: (r) => ({
    text:
      r.tickers.length > 0
        ? `${r.name} trades as ${r.tickers.join(", ")} (SEC CIK ${r.id}).`
        : `${r.name} files with the SEC as CIK ${r.id}.`,
    sourceLocator: `SEC EDGAR page for CIK ${r.id} (tickers from SEC's company_tickers_exchange.json); sec.gov turns away scripts, so open it in a browser`,
  }),

  resolutions: (r, _f, n) => {
    const colon = r.src.indexOf(":");
    const kind = r.src.slice(0, colon);
    const key = r.src.slice(colon + 1);

    const name =
      kind === "pac" ? `The political committee ${quote(n.pac(key))}` : `The lobbying client ${quote(n.client(key))}`;

    return { text: `${name} is taken to be ${n.company(r.company_id)}.` };
  },

  benefits: (r, _f, n) => ({
    text: `${n.company(r.company_id)} is tied to ${filled(r.section_id) ? `${sec(n, r.section_id)} of ` : ""}${n.bill} because ${r.basis_rule === "lobbied" ? "it lobbied on it" : "the text names it"}.`,
  }),

  attention: (r, _f, n) => {
    const subject = filled(r.section_id) ? sec(n, r.part_id ?? r.section_id) : `${n.bill} as a whole`;

    const trade =
      r.trade_legal_hits === 0 ? "" : ` Trade and legal press: ${count(r.trade_legal_hits, "more article")}.`;

    if (r.hits === 0) {
      return {
        text: `None of the ${n.sample.relevant.toLocaleString("en-US")} relevant articles read (out of ${n.sample.found.toLocaleString("en-US")} found) matched ${subject}. Only a few hundred articles are read, so zero means none among those, not that nobody covered it.${trade}`,
        sourceLocator: ATTENTION_LOCATOR,
        sourceUrl: `${DOCS}#attention-v2`,
      };
    }

    const rank = missing(r.pct)
      ? ""
      : r.pct >= 0.995
        ? ", the most covered section of this bill"
        : r.pct <= 0.005
          ? ", among the least covered sections of this bill"
          : `, more than ${Math.round(r.pct * 100)}% of this bill's other sections`;

    return {
      text: `${r.hits.toLocaleString("en-US")} of the ${n.sample.relevant.toLocaleString("en-US")} relevant articles read (out of ${n.sample.found.toLocaleString("en-US")} found) matched ${subject}${rank}.${trade}`,
      sourceLocator: ATTENTION_LOCATOR,
      sourceUrl: `${DOCS}#attention-v2`,
    };
  },

  attention_checks: (r, _f, n) => ({
    text: `${sec(n, r.part_id ?? r.section_id).replace(/^s/u, "S")}: a second look put the ${r.passages} news passages closest to it to a model, which said ${r.article_ids.length > 0 ? `${count(r.article_ids.length, "article")} the section matcher had missed describe what it does` : "none beyond the articles already matched describe what it does"}. With those added, ${(r.share * 100).toFixed(1)}% of the bill's relevant articles discuss it.`,
    sourceUrl: `${DOCS}#quiet-check-v1`,
    sourceLocator: 'how the check works; the articles it found are under "rests on"',
  }),

  counterparts: (r, _f, n) => ({
    text: `${sec(n, r.removed_section_id).replace(/^s/u, "S")} is taken to be rewritten as ${sec(n, r.added_section_id)}.`,
  }),

  section_reach: (r, _f, n) => ({
    text: `${sec(n, r.part_id ?? r.section_id).replace(/^s/u, "S")}, in the ${n.version(r.version)} text, reads: ${quote(r.quote, 600)}`,
    quote: r.quote,
    sourceLocator: `${r.source_locator}; it is tagged "${REACH_WORDS[r.kind]}" by the published reach-v2 patterns`,
  }),

  section_scores: (r, _f, n) => {
    const ev = scoreEvidence(r.evidence);
    const against = ev.dollarsByBaseline;
    const others = against.filter((b) => b.baseline !== ev.dollarsBaseline);

    const both =
      against.length < 2
        ? ""
        : others.every((b) => b.musd === r.dollars_musd)
          ? " (the same against current law and current policy)"
          : ` against ${baseName(ev.dollarsBaseline ?? "")} (${others.map((b) => `${musd(b.musd)} against ${baseName(b.baseline)}`).join(", ")}; the smaller counts)`;

    const bits = [
      missing(r.dollars_musd)
        ? "no CBO dollars"
        : `CBO says it ${r.dollars_musd < 0 ? "cuts" : "adds"} ${musd(r.dollars_musd)} ${r.dollars_musd < 0 ? "from" : "to"} the deficit${both}${r.dollars_split === "even_split" ? " (even split)" : ""}`,
      missing(r.attention_share)
        ? missing(r.attention_pct)
          ? "attention unmeasured"
          : `attention at the ${ordinal(Math.round(r.attention_pct * 100))} percentile`
        : `${(r.attention_share * 100).toFixed(1)}% of the bill's relevant articles discussed it`,
      r.late
        ? "added late"
        : filled(r.late_cleared_by)
          ? `not added late (it rewrites ${sec(n, r.late_cleared_by)}, which was in the text before a chamber passed it)`
          : "not added late",
      missing(r.off_topic) ? null : `off-topic distance ${r.off_topic.toFixed(2)}`,
      r.lobbying_reports === 0
        ? "no lobbying reports"
        : `${count(r.lobbying_reports, "lobbying report")} from ${count(r.lobbying_firms, "firm")}`,
      r.reach.length > 0 ? `its text ${r.reach.map((k) => REACH_WORDS[k]).join(" and ")} (reach-v2)` : null,
    ].filter((b) => b !== null);

    const score = missing(r.buried) ? "" : ` (buried score ${r.buried.toFixed(2)})`;

    const pays = filled(r.offsets_section_id)
      ? ` CBO prints exactly the opposite figure for ${sec(n, r.offsets_section_id)}, so this is read as the section's pay-for and is not flagged on its own.`
      : "";

    return {
      text: `${sec(n, r.part_id ?? r.section_id).replace(/^s/u, "S")}${filled(r.part_id) ? `, a part of ${sec(n, r.section_id)} scored on its own (parts-v1),` : ""} is scored ${r.label}${score}: ${bits.join(", ")}.${pays}`,
    };
  },
} satisfies Templates;

export const INFERENCE_TABLES = new Set<TableName>([
  "amendment_sections",
  "cbo_notes",
  "lda_topic_refs",
  "lda_spend",
  "resolutions",
  "benefits",
  "attention",
  "attention_checks",
  "counterparts",
  "section_scores",
]);

interface Provenance {
  id: string;
  source_url?: string;
  source_locator?: string | null;
  archive_url?: string | null;
  confidence?: number;
  rule?: string;
  rests_on?: string[];
  evidence?: Row<"resolutions">["evidence"];
}

export function restsOnOf<T extends TableName>(table: T, row: CitedRow<T>, facet: string | null, n: Names): ClaimId[] {
  const p: Provenance = row;

  return template(table)(row, facet, n).restsOn ?? p.rests_on ?? [];
}

export function mintClaim<T extends TableName>(
  table: T,
  row: CitedRow<T>,
  facet: string | null,
  n: Names,
  restsOn: ClaimId[],
  sourceOf: (ids: ClaimId[]) => string | undefined,
): Claim {
  const w = template(table)(row, facet, n);
  const p: Provenance = row;
  const kind = w.kind ?? (INFERENCE_TABLES.has(table) ? "inference" : "fact");

  return Claim.parse({
    id: `${table}/${row.id}${filled(facet) ? `#${facet}` : ""}`,
    text: w.text,
    kind,
    sourceUrl: w.sourceUrl ?? p.source_url ?? p.evidence?.source_url ?? p.evidence?.url ?? sourceOf(restsOn),
    sourceLocator: w.sourceLocator ?? p.source_locator ?? null,
    archiveUrl: p.archive_url ?? null,
    quote: w.quote ?? null,
    confidence: w.confidence ?? p.confidence ?? 1,
    restsOn,
    rule: kind === "inference" ? (w.rule ?? p.rule ?? null) : null,
  });
}

function template<T extends TableName>(table: T): Template<T> {
  const all: Templates = TEMPLATES;
  const t = all[table];

  if (!t) {
    throw new Error(`no claim template for ${table}`);
  }

  return t;
}
