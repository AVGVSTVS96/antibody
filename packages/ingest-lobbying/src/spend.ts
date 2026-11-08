import type { BillId, Row } from "@antibody/core";

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

interface Counted {
  report: Row<"lda_filings">;
  lines: Line[];
}

export function spendRows(
  bill: BillId,
  filings: Map<string, Row<"lda_filings">>,
  lines: Line[],
  topicOnly = false,
): Row<"lda_spend">[] {
  const byFiling = new Map<string, Counted>();

  for (const l of lines) {
    const f = filings.get(l.filing_id);

    if (f?.form !== "LD-2" || f.superseded) {
      continue;
    }

    const entry = byFiling.get(l.filing_id);
    byFiling.set(l.filing_id, { report: f, lines: [...(entry?.lines ?? []), l] });
  }

  const byClient = new Map<string, Counted[]>();

  for (const c of byFiling.values()) {
    byClient.set(c.report.client_key, [...(byClient.get(c.report.client_key) ?? []), c]);
  }

  const suffix = topicOnly ? ":topic" : "";
  const rows: Row<"lda_spend">[] = [];

  for (const [client, reports] of byClient) {
    const quarters = new Map<string, Counted[]>();

    for (const c of reports) {
      const q = `${c.report.year}|${c.report.period}`;
      quarters.set(q, [...(quarters.get(q) ?? []), c]);
    }

    let total = 0;
    let share = 0;
    let anyAmount = false;
    const counted: Counted[] = [];

    for (const q of quarters.values()) {
      const inHouse = q.filter((c) => c.report.amount_kind === "expenses");

      for (const c of inHouse.length ? inHouse : q.filter((x) => x.report.amount_kind === "income")) {
        anyAmount = true;
        counted.push(c);
        total += c.report.amount_usd ?? 0;
        share += ((c.report.amount_usd ?? 0) * c.lines.length) / Math.max(1, c.report.issue_lines);
      }
    }

    const clientLines = reports.flatMap((c) => c.lines);
    const phases = count(reports.flatMap((c) => c.lines.slice(0, 1)));
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
      total_rests_on: counted.map((c) => claim.filing(c.report.id)),
      issue_quote: specific?.quote ?? null,
      section_nums: [...new Set(clientLines.flatMap((l) => l.section_nums))],
      rule: topicOnly ? "lda-topic-only" : "lda-bill-share",
      confidence: 0.5,
      rests_on: [
        ...counted.map((c) => claim.filing(c.report.id)),
        ...clientLines.map((l) => (topicOnly ? claim.topic(l.id) : claim.ref(l.id))),
      ],
      evidence: {
        method: topicOnly ? "topic-only lines" : "amount × lines naming the bill ÷ all lines",
        counted: counted.map((c) => ({
          filing: c.report.id,
          amount_usd: c.report.amount_usd,
          kind: c.report.amount_kind,
          lines: c.lines.length,
          of: c.report.issue_lines,
        })),
      },
    });
  }

  if (!rows.length) {
    return rows;
  }

  const reports = [...byFiling.values()];
  const phases = count(reports.flatMap((c) => c.lines.slice(0, 1)));
  const withAmount = rows.filter((r) => r.total_usd !== null);
  const whole = `${bill}:*${suffix}`;
  rows.push({
    id: whole,
    bill_id: bill,
    client_key: null,
    topic_only: topicOnly,
    reports: reports.length,
    quarters: new Set(reports.map((c) => `${c.report.year}|${c.report.period}`)).size,
    reports_bill: phases.bill,
    reports_enactment_quarter: phases["enactment-quarter"],
    reports_law: phases.law,
    total_usd: withAmount.length ? withAmount.reduce((sum, r) => sum + (r.total_usd ?? 0), 0) : null,
    share_usd: withAmount.length && !topicOnly ? withAmount.reduce((sum, r) => sum + (r.share_usd ?? 0), 0) : null,
    total_rests_on: withAmount.map((r) => claim.spend(r.id, "total")),
    issue_quote: null,
    section_nums: [],
    rule: topicOnly ? "lda-topic-only" : "lda-bill-share",
    confidence: 0.5,
    rests_on: rows.map((r) => claim.spend(r.id, r.share_usd === null ? "total" : "share")),
    evidence: { method: "sum of the per-client rows", clients: rows.length },
  });

  return rows;
}

function count(firstLines: Line[]) {
  const c = { bill: 0, "enactment-quarter": 0, law: 0 };

  for (const l of firstLines) {
    c[l.phase]++;
  }

  return c;
}

function latest(lines: Line[], filings: Map<string, Row<"lda_filings">>): Line | undefined {
  const at = (l: Line) => filings.get(l.filing_id)?.period_end ?? "";

  return lines.reduce<Line | undefined>((b, l) => (b === undefined || at(l) > at(b) ? l : b), undefined);
}
