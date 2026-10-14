import type { BillId, Row } from "@antibody/core";

/** Published rules this package's inferences apply; store copies them into bundle.rules. */
export const RULES = [
  {
    id: "lda-bill-share",
    version: "1",
    text:
      "An LD-2 report gives one total for all its issues. The bill-share estimate takes each counted report's " +
      "amount times the share of its issue lines that name the bill. Per client and quarter, the client's own " +
      "in-house expenses are counted when it filed them (they already include what it paid outside firms); " +
      "otherwise the outside firms' income is added up.",
    url: null,
  },
  {
    id: "lda-topic-only",
    version: "1",
    text:
      "An issue line that describes the bill's subject while it was pending, names no bill number, short title or " +
      "public law, and that a model judged to be about this legislation. Shown dashed, off by default.",
    url: null,
  },
] as const;

const claim = {
  filing: (uuid: string) => `lda_filings/${uuid}`,
  ref: (id: string) => `lda_bill_refs/${id}`,
  topic: (id: string) => `lda_topic_refs/${id}`,
  spend: (id: string, facet: "total" | "share") => `lda_spend/${id}#${facet}`,
};

interface Line {
  id: string;
  filing_id: string;
  phase: Row<"lda_bill_refs">["phase"];
  quote: string;
  section_nums: string[];
}

/**
 * Spend per client for one bill, and for the whole bill. Only LD-2 reports that are not superseded count.
 * `#total` (always minted; a null amount reads "no amount reported") is a fact summed from the reports;
 * `#share` (minted when share_usd is set) is the lda-bill-share inference.
 * `topicOnly` builds the same rows from topic-only lines (share left out: it would be an estimate on an inference).
 */
export function spendRows(
  bill: BillId,
  filings: Map<string, Row<"lda_filings">>,
  lines: Line[],
  topicOnly = false,
): Row<"lda_spend">[] {
  const linesByFiling = new Map<string, Line[]>();
  for (const l of lines) {
    const f = filings.get(l.filing_id);
    if (!f || f.form !== "LD-2" || f.superseded) continue;
    linesByFiling.set(l.filing_id, [...(linesByFiling.get(l.filing_id) ?? []), l]);
  }

  const byClient = new Map<string, Row<"lda_filings">[]>();
  for (const id of linesByFiling.keys()) {
    const f = filings.get(id)!;
    byClient.set(f.client_key, [...(byClient.get(f.client_key) ?? []), f]);
  }

  const suffix = topicOnly ? ":topic" : "";
  const rows: Row<"lda_spend">[] = [];
  for (const [client, reports] of byClient) {
    const quarters = new Map<string, Row<"lda_filings">[]>();
    for (const f of reports)
      quarters.set(`${f.year}|${f.period}`, [...(quarters.get(`${f.year}|${f.period}`) ?? []), f]);
    let total = 0;
    let share = 0;
    let anyAmount = false;
    const counted: Row<"lda_filings">[] = [];
    for (const q of quarters.values()) {
      const inHouse = q.filter((f) => f.amount_kind === "expenses");
      for (const f of inHouse.length ? inHouse : q.filter((f) => f.amount_kind === "income")) {
        anyAmount = true;
        counted.push(f);
        total += f.amount_usd ?? 0;
        share += ((f.amount_usd ?? 0) * linesByFiling.get(f.id)!.length) / Math.max(1, f.issue_lines);
      }
    }
    const clientLines = reports.flatMap((f) => linesByFiling.get(f.id)!);
    const phases = count(reports.map((f) => linesByFiling.get(f.id)![0]!.phase));
    const specific = clientLines.find((l) => l.section_nums.length) ?? latest(clientLines, filings);
    const id = `${bill}:${client}${suffix}`;
    rows.push({
      id,
      bill_id: bill,
      client_key: client,
      topic_only: topicOnly,
      reports: reports.length,
      quarters: quarters.size,
      reports_bill: phases.bill,
      reports_enactment_quarter: phases["enactment-quarter"],
      reports_law: phases.law,
      total_usd: anyAmount ? total : null,
      share_usd: anyAmount && !topicOnly ? Math.round(share) : null,
      total_rests_on: counted.map((f) => claim.filing(f.id)),
      issue_quote: specific?.quote ?? null,
      section_nums: [...new Set(clientLines.flatMap((l) => l.section_nums))],
      rule: topicOnly ? "lda-topic-only" : "lda-bill-share",
      confidence: 0.5,
      rests_on: [
        ...counted.map((f) => claim.filing(f.id)),
        ...clientLines.map((l) => (topicOnly ? claim.topic(l.id) : claim.ref(l.id))),
      ],
      evidence: {
        method: topicOnly ? "topic-only lines" : "amount × lines naming the bill ÷ all lines",
        counted: counted.map((f) => ({
          filing: f.id,
          amount_usd: f.amount_usd,
          kind: f.amount_kind,
          lines: linesByFiling.get(f.id)!.length,
          of: f.issue_lines,
        })),
      },
    });
  }
  if (!rows.length) return rows;

  const reports = [...linesByFiling.keys()].map((id) => filings.get(id)!);
  const phases = count(reports.map((f) => linesByFiling.get(f.id)![0]!.phase));
  const withAmount = rows.filter((r) => r.total_usd != null);
  const whole = `${bill}:*${suffix}`;
  rows.push({
    id: whole,
    bill_id: bill,
    client_key: null,
    topic_only: topicOnly,
    reports: reports.length,
    quarters: new Set(reports.map((f) => `${f.year}|${f.period}`)).size,
    reports_bill: phases.bill,
    reports_enactment_quarter: phases["enactment-quarter"],
    reports_law: phases.law,
    total_usd: withAmount.length ? withAmount.reduce((s, r) => s + r.total_usd!, 0) : null,
    share_usd: withAmount.length && !topicOnly ? withAmount.reduce((s, r) => s + r.share_usd!, 0) : null,
    total_rests_on: withAmount.map((r) => claim.spend(r.id, "total")),
    issue_quote: null,
    section_nums: [],
    rule: topicOnly ? "lda-topic-only" : "lda-bill-share",
    confidence: 0.5,
    rests_on: rows.map((r) => claim.spend(r.id, r.share_usd != null ? "share" : "total")),
    evidence: { method: "sum of the per-client rows", clients: rows.length },
  });
  return rows;
}

function count(phases: Line["phase"][]) {
  const c = { bill: 0, "enactment-quarter": 0, law: 0 };
  for (const p of phases) c[p]++;
  return c;
}

function latest(lines: Line[], filings: Map<string, Row<"lda_filings">>): Line | undefined {
  const at = (l: Line) => {
    const f = filings.get(l.filing_id)!;
    return f.period_end;
  };
  return lines.reduce<Line | undefined>((b, l) => (!b || at(l) > at(b) ? l : b), undefined);
}
