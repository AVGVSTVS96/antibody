import { bills } from "./bills";
import { bestConfidence, findRefs, type Ref } from "./extract";

const data = new URL("../../data/lobbying/", import.meta.url).pathname;
const out = new URL("./out/", import.meta.url).pathname;

const enacted: Record<string, string> = { genius: "2025-07-18", obbba: "2025-07-04", ira: "2022-08-16" };
const periodEnd: Record<string, string> = {
  first_quarter: "03-31", second_quarter: "06-30", third_quarter: "09-30", fourth_quarter: "12-31", mid_year: "06-30", year_end: "12-31",
};
const periodStart: Record<string, string> = {
  first_quarter: "01-01", second_quarter: "04-01", third_quarter: "07-01", fourth_quarter: "10-01", mid_year: "01-01", year_end: "07-01",
};

function phase(f: any, billKey: string) {
  const start = `${f.filing_year}-${periodStart[f.filing_period] ?? "01-01"}`;
  const end = `${f.filing_year}-${periodEnd[f.filing_period] ?? "12-31"}`;
  if (end < enacted[billKey]!) return "bill";
  if (start > enacted[billKey]!) return "law";
  return "enactment-quarter";
}

const lobbyistName = (l: any) => [l.first_name, l.middle_name, l.last_name, l.suffix_display].filter(Boolean).join(" ");

export type Match = {
  filing_uuid: string;
  filing_url: string;
  api_url: string;
  filing_type: string;
  filing_year: number;
  filing_period: string;
  phase: string;
  dt_posted: string;
  registrant: { id: number; name: string };
  client: { id: number; name: string; description: string | null };
  amount: number | null;
  amount_kind: "income" | "expenses" | null;
  confidence: Ref["confidence"];
  activities_total: number;
  activities: { issue_code: string; description: string; refs: Ref[]; lobbyists: { id: number; name: string; covered_position: string | null }[] }[];
  superseded?: boolean;
};

export async function matchesFor(billKey: string): Promise<{ candidates: number; matches: Match[] }> {
  const lines = (await Bun.file(`${data}${billKey}/filings.jsonl`).text()).trim().split("\n");
  const matches: Match[] = [];
  for (const line of lines) {
    const f = JSON.parse(line);
    const activities = (f.lobbying_activities ?? [])
      .map((a: any) => ({
        issue_code: a.general_issue_code,
        description: a.description ?? "",
        refs: findRefs(a.description ?? "", f.filing_year, f.filing_period, billKey),
        lobbyists: (a.lobbyists ?? []).map((x: any) => ({ id: x.lobbyist.id, name: lobbyistName(x.lobbyist), covered_position: x.covered_position })),
      }))
      .filter((a: any) => a.refs.length);
    if (!activities.length) continue;
    const confidence = bestConfidence(activities.flatMap((a: any) => a.refs))!;
    matches.push({
      filing_uuid: f.filing_uuid,
      filing_url: f.filing_document_url,
      api_url: f.url,
      filing_type: f.filing_type,
      filing_year: f.filing_year,
      filing_period: f.filing_period,
      phase: phase(f, billKey),
      dt_posted: f.dt_posted,
      registrant: { id: f.registrant.id, name: f.registrant.name },
      client: { id: f.client.id, name: f.client.name, description: f.client.general_description },
      amount: f.income != null ? Number(f.income) : f.expenses != null ? Number(f.expenses) : null,
      amount_kind: f.income != null ? "income" : f.expenses != null ? "expenses" : null,
      confidence,
      activities_total: (f.lobbying_activities ?? []).length,
      activities,
    });
  }
  const latest = new Map<string, Match>();
  for (const m of matches) {
    if (m.filing_type.startsWith("R")) continue;
    const key = `${m.registrant.id}|${m.client.id}|${m.filing_year}|${m.filing_period}`;
    const prev = latest.get(key);
    if (!prev || m.dt_posted > prev.dt_posted) latest.set(key, m);
  }
  const keep = new Set([...latest.values()]);
  for (const m of matches) if (!m.filing_type.startsWith("R") && !keep.has(m)) m.superseded = true;
  return { candidates: lines.length, matches };
}

export function clientKey(name: string) {
  return name
    .toUpperCase()
    .replace(/^.*\b(?:OBO|ON BEHALF OF|O\/B\/O)\b/, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\b(THE|INC|INCORPORATED|LLC|L L C|LP|LLP|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|HOLDINGS?|GROUP|N A|NA|USA|U S A|US|U S|AND AFFILIATES|AFFILIATES|AND ITS SUBSIDIARIES|AND VARIOUS SUBSIDIARIES|SUBSIDIARIES)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const share = (m: Match) => ((m.amount ?? 0) * m.activities.length) / Math.max(1, m.activities_total);

function clientSpend(reports: Match[]) {
  const quarters = new Map<string, Match[]>();
  for (const m of reports) {
    const k = `${clientKey(m.client.name)}|${m.filing_year}|${m.filing_period}`;
    quarters.set(k, [...(quarters.get(k) ?? []), m]);
  }
  const spend = new Map<string, { usd: number; share_usd: number }>();
  for (const ms of quarters.values()) {
    const inHouse = ms.filter((m) => m.amount_kind === "expenses");
    const counted = inHouse.length ? inHouse : ms.filter((m) => m.amount_kind === "income");
    const key = clientKey(ms[0]!.client.name);
    const s = spend.get(key) ?? { usd: 0, share_usd: 0 };
    for (const m of counted) { s.usd += m.amount ?? 0; s.share_usd += share(m); }
    spend.set(key, s);
  }
  return spend;
}

function summarize(billKey: string, all: Match[], minConfidence: Ref["confidence"][]) {
  const reports = all.filter((m) => !m.superseded && !m.filing_type.startsWith("R") && minConfidence.includes(m.confidence));
  const registrations = all.filter((m) => m.filing_type.startsWith("R") && minConfidence.includes(m.confidence));
  const clients = new Map<string, any>();
  const registrants = new Map<number, any>();
  const lobbyists = new Map<number, any>();
  const codes = new Map<string, number>();
  for (const m of reports) {
    const ck = clientKey(m.client.name);
    const c = clients.get(ck) ?? { key: ck, names: new Set(), client_ids: new Set(), reports: 0, quarters: new Set(), registrants: new Set(), phases: new Set(), sample_filing: m.filing_url };
    c.names.add(m.client.name); c.client_ids.add(m.client.id);
    c.reports++; c.quarters.add(`${m.filing_year} ${m.filing_period}`); c.registrants.add(m.registrant.name); c.phases.add(m.phase);
    clients.set(ck, c);
    const r = registrants.get(m.registrant.id) ?? { id: m.registrant.id, name: m.registrant.name, reports: 0, clients: new Set(), amount_on_reports: 0 };
    r.reports++; r.clients.add(m.client.name); r.amount_on_reports += m.amount ?? 0;
    registrants.set(m.registrant.id, r);
    for (const a of m.activities) {
      codes.set(a.issue_code, (codes.get(a.issue_code) ?? 0) + 1);
      for (const l of a.lobbyists) {
        const x = lobbyists.get(l.id) ?? { id: l.id, name: l.name, covered_positions: new Set(), clients: new Set(), reports: new Set(), sample_filing: m.filing_url };
        if (l.covered_position) x.covered_positions.add(l.covered_position);
        x.clients.add(m.client.name); x.reports.add(m.filing_uuid);
        lobbyists.set(l.id, x);
      }
    }
  }
  const plain = (o: any) => JSON.parse(JSON.stringify(o, (_k, v) => (v instanceof Set ? [...v] : v)));
  const lob = [...lobbyists.values()].map((l) => ({ ...l, reports: l.reports.size }));
  const spend = clientSpend(reports);
  for (const c of clients.values()) {
    c.total_spend_on_quarters_usd = spend.get(c.key)?.usd ?? 0;
    c.bill_share_estimate_usd = Math.round(spend.get(c.key)?.share_usd ?? 0);
    c.quarters = c.quarters.size;
    c.firms = c.registrants.size;
  }
  return {
    bill: bills.find((b) => b.key === billKey)!.name,
    reports: reports.length,
    registrations: registrations.length,
    by_phase: Object.fromEntries(["bill", "enactment-quarter", "law"].map((p) => [p, reports.filter((m) => m.phase === p).length])),
    clients: clients.size,
    registrants: registrants.size,
    lobbyists: lob.length,
    lobbyists_with_covered_position: lob.filter((l) => l.covered_positions.size).length,
    total_spend_on_quarters_usd: [...spend.values()].reduce((s, x) => s + x.usd, 0),
    bill_share_estimate_usd: Math.round([...spend.values()].reduce((s, x) => s + x.share_usd, 0)),
    issue_codes: Object.fromEntries([...codes].sort((a, b) => b[1] - a[1])),
    top_clients: plain([...clients.values()].sort((a, b) => b.firms - a.firms || b.quarters - a.quarters || b.bill_share_estimate_usd - a.bill_share_estimate_usd).slice(0, 25)),
    top_clients_by_share_estimate: plain([...clients.values()].sort((a, b) => b.bill_share_estimate_usd - a.bill_share_estimate_usd).slice(0, 15)),
    top_registrants: plain([...registrants.values()].sort((a, b) => b.clients.size - a.clients.size).slice(0, 15).map((r) => ({ ...r, clients: r.clients.size }))),
    covered_lobbyists_sample: plain(lob.filter((l) => l.covered_positions.size).sort((a, b) => b.reports - a.reports).slice(0, 25)),
  };
}

if (import.meta.main) {
  const keys = process.argv.slice(2);
  for (const bill of bills.filter((b) => !keys.length || keys.includes(b.key))) {
    if (!(await Bun.file(`${data}${bill.key}/filings.jsonl`).exists())) { console.error(bill.key, "not pulled yet"); continue; }
    const { candidates, matches } = await matchesFor(bill.key);
    await Bun.write(`${data}${bill.key}/matches.jsonl`, matches.map((m) => JSON.stringify(m)).join("\n") + "\n");
    const conf = { high: 0, medium: 0, low: 0 } as Record<string, number>;
    for (const m of matches) conf[m.confidence]!++;
    const summary = { candidates_from_api: candidates, matched_filings: matches.length, by_confidence: conf, ...summarize(bill.key, matches, ["high", "medium"]) };
    await Bun.write(`${out}${bill.key}.json`, JSON.stringify(summary, null, 1));
    console.log(bill.key, JSON.stringify({ candidates, matched: matches.length, conf, reports: summary.reports, clients: summary.clients, registrants: summary.registrants, lobbyists: summary.lobbyists, covered: summary.lobbyists_with_covered_position, usd: summary.total_spend_on_quarters_usd, usd_share: summary.bill_share_estimate_usd, phases: summary.by_phase }));
  }
}
