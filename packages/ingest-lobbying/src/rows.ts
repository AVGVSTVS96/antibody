import type { BillId, Row } from "@antibody/core";
import { best, findRefs, type Matcher, period, sectionNums } from "./extract.ts";
import type { LdaFiling, LdaLobbyist } from "./lda.ts";

export type Phase = Row<"lda_bill_refs">["phase"];

/** Before the quarter of enactment, that quarter, or after. A bill that never became law is always "bill". */
export function phaseOf(start: string, end: string, enactedOn: string | null): Phase {
  if (!enactedOn || end < enactedOn) return "bill";
  if (start > enactedOn) return "law";
  return "enactment-quarter";
}

const SUFFIXES =
  /\b(THE|INC|INCORPORATED|LLC|L L C|LP|LLP|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|HOLDINGS?|GROUP|N A|NA|USA|U S A|US|U S|AND AFFILIATES|AFFILIATES|AND ITS SUBSIDIARIES|AND VARIOUS SUBSIDIARIES|SUBSIDIARIES)\b/g;

/**
 * lda.gov gives every registrant/client pair its own client id, so one company shows up under many ids.
 * Clients merge on this key: the name without legal suffixes or an "on behalf of" prefix, as a slug ("visa").
 */
export function clientKey(name: string, ldaClientId: number | string): string {
  const key = name
    .toUpperCase()
    .replace(/^.*\b(?:OBO|ON BEHALF OF|O\/B\/O)\b/, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(SUFFIXES, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  return key || `lda-${ldaClientId}`;
}

const lobbyistName = ({ lobbyist: l }: LdaLobbyist) =>
  [l.prefix_display, l.first_name, l.middle_name, l.last_name, l.suffix_display].filter(Boolean).join(" ");

const amountOf = (f: LdaFiling): [number | null, "income" | "expenses" | null] =>
  f.income != null
    ? [Number(f.income), "income"]
    : f.expenses != null
      ? [Number(f.expenses), "expenses"]
      : [null, null];

export function filingRow(f: LdaFiling): Row<"lda_filings"> {
  const p = period(f.filing_year, f.filing_period);
  const [amount, kind] = amountOf(f);
  return {
    id: f.filing_uuid,
    url: f.filing_document_url,
    api_url: f.url,
    form: f.filing_type.startsWith("R") ? "LD-1" : "LD-2",
    type: f.filing_type,
    year: f.filing_year,
    period: f.filing_period,
    period_start: p.start,
    period_end: p.end,
    posted_at: f.dt_posted,
    registrant_id: String(f.registrant.id),
    registrant_name: f.registrant.name,
    client_key: clientKey(f.client.name, f.client.id),
    lda_client_id: String(f.client.id),
    client_name: f.client.name,
    client_description: f.client.general_description || null,
    amount_usd: amount,
    amount_kind: kind,
    issue_lines: f.lobbying_activities.length,
    superseded: false,
    source_url: f.filing_document_url,
    source_locator: kind === "income" ? "Income line" : kind === "expenses" ? "Expenses line" : null,
  };
}

export interface Extracted {
  filings: Row<"lda_filings">[];
  refs: Row<"lda_bill_refs">[];
  lobbyists: Row<"lda_lobbyists">[];
  clients: Row<"lda_clients">[];
}

/**
 * Reads every issue line of every pulled filing against the bill's aliases. A line that names the bill becomes
 * an lda_bill_refs row (low matches kept, held out downstream); its lobbyists get the bill on their row.
 */
export function extract(bill: BillId, all: LdaFiling[], m: Matcher, knownSections?: Set<string>): Extracted {
  const out: Extracted = { filings: [], refs: [], lobbyists: [], clients: [] };
  const clients = new Map<string, Row<"lda_clients">>();
  for (const f of all) {
    const p = period(f.filing_year, f.filing_period);
    const phase = phaseOf(p.start, p.end, m.aliases.enactedOn);
    const lines = f.lobbying_activities;
    const lobbyists = new Map<string, Row<"lda_lobbyists">>();
    let named = false;
    for (const [i, a] of lines.entries()) {
      const text = a.description ?? "";
      const ref = best(findRefs(text, p, m));
      if (!ref) continue;
      named = true;
      const sections = sectionNums(text, m).filter((s) => !knownSections?.size || knownSections.has(s));
      out.refs.push({
        id: `${f.filing_uuid}#${i}#${bill}`,
        filing_id: f.filing_uuid,
        bill_id: bill,
        line: i + 1,
        section_nums: sections,
        issue_code: a.general_issue_code,
        quote: text.trim(),
        matched: ref.text,
        how: ref.how,
        match: ref.level,
        why: ref.why,
        phase,
        source_url: f.filing_document_url,
        source_locator: `issue line ${i + 1} of ${lines.length} (${a.general_issue_code})`,
      });
      if (ref.level === "low") continue;
      for (const l of a.lobbyists) {
        const id = `${f.filing_uuid}:${l.lobbyist.id}`;
        const prev = lobbyists.get(id);
        lobbyists.set(id, {
          id,
          filing_id: f.filing_uuid,
          lobbyist_id: String(l.lobbyist.id),
          name: lobbyistName(l),
          covered_position: prev?.covered_position ?? (l.covered_position?.trim() || null),
          bill_ids: [bill],
          source_url: f.filing_document_url,
          source_locator: `issue line ${i + 1} of ${lines.length}, lobbyist ${lobbyistName(l)}`,
        });
      }
    }
    if (!named) continue;
    const row = filingRow(f);
    out.filings.push(row);
    out.lobbyists.push(...lobbyists.values());
    const c = clients.get(row.client_key) ?? {
      id: row.client_key,
      name: f.client.name,
      lda_client_ids: [],
      names: [],
      description: row.client_description,
    };
    if (!c.lda_client_ids.includes(row.lda_client_id)) c.lda_client_ids.push(row.lda_client_id);
    if (!c.names.includes(f.client.name)) c.names.push(f.client.name);
    c.description ??= row.client_description;
    clients.set(row.client_key, c);
  }
  out.clients = [...clients.values()];
  return out;
}

const posted = (r: Row<"lda_filings">) => (r.posted_at ? Date.parse(r.posted_at) : 0);

/** Among LD-2 reports for the same registrant, client and period, the latest posted replaces the rest. */
export function markSuperseded(rows: Row<"lda_filings">[]): Row<"lda_filings">[] {
  const latest = new Map<string, Row<"lda_filings">>();
  for (const r of rows) {
    if (r.form !== "LD-2") continue;
    const key = `${r.registrant_id}|${r.lda_client_id}|${r.year}|${r.period}`;
    const prev = latest.get(key);
    if (!prev || posted(r) > posted(prev)) latest.set(key, r);
  }
  const keep = new Set(latest.values());
  return rows.map((r) => ({ ...r, superseded: r.form === "LD-2" && !keep.has(r) }));
}
