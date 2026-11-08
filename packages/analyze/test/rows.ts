import type { Row } from "@antibody/core";

const BILL = "119-hr-1";
const URL = "https://www.govinfo.gov/content/pkg/PLAW-119publ21/uslm/PLAW-119publ21.xml";

export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("expected a value");
  }

  return value;
}

export const sectionRow = (id: string, over: Partial<Row<"sections">> = {}): Row<"sections"> => ({
  id,
  bill_id: BILL,
  num: id,
  heading: `Section ${id}`,
  path: `sec:${id}`,
  first_version: "ih",
  in_final: true,
  changed_in: [],
  removed_in: null,
  revived_in: [],
  split_from: null,
  split_into: [],
  merged_into: null,
  late: false,
  words: 100,
  text_url: URL,
  preview: "p",
  history: {},
  source_url: URL,
  source_locator: null,
  ...over,
});

export const articleRow = (id: string, over: Partial<Row<"articles">> = {}): Row<"articles"> => ({
  id,
  bill_id: BILL,
  url: `https://example.com/${id}`,
  outlet_id: null,
  title: id,
  published_on: null,
  via: "mediacloud",
  text_chars: null,
  source_url: `https://example.com/${id}`,
  source_locator: null,
  ...over,
});

const inference = { rule: "test", confidence: 0.5, rests_on: [], evidence: {} };

export const attentionRow = (id: string, over: Partial<Row<"attention">> = {}): Row<"attention"> => ({
  id,
  bill_id: BILL,
  section_id: null,
  part_id: null,
  hits: 0,
  hits_by_group: {},
  trade_legal_hits: 0,
  pct: null,
  example_article_ids: [],
  ...inference,
  ...over,
});

export const checkRow = (id: string, over: Partial<Row<"attention_checks">> = {}): Row<"attention_checks"> => ({
  id,
  bill_id: BILL,
  section_id: "",
  part_id: null,
  passages: 0,
  article_ids: [],
  share: 0,
  ...inference,
  ...over,
});

export const reachRow = (id: string, over: Partial<Row<"section_reach">> = {}): Row<"section_reach"> => ({
  id,
  bill_id: BILL,
  section_id: "",
  part_id: null,
  kind: "courts",
  pattern: "no-court",
  quote: "no court shall have jurisdiction",
  version: "plaw",
  source_url: URL,
  source_locator: null,
  ...over,
});

export const estimateRow = (id: string, over: Partial<Row<"cbo_estimates">> = {}): Row<"cbo_estimates"> => ({
  id,
  bill_id: BILL,
  url: "https://www.cbo.gov/publication/61570",
  file_url: "https://www.cbo.gov/system/files/2025-07/61570.xlsx",
  archive_url: null,
  published_on: null,
  version_code: null,
  version_scored: "",
  baseline: "current-law",
  baseline_label: "",
  per_section: true,
  mandate_private: null,
  mandate_intergovernmental: null,
  pdf_url: null,
  pdf_archive_url: null,
  source_url: "https://www.cbo.gov/publication/61570",
  source_locator: null,
  ...over,
});

export const counterpartRow = (id: string, over: Partial<Row<"counterparts">> = {}): Row<"counterparts"> => ({
  id,
  bill_id: BILL,
  removed_section_id: "",
  added_section_id: "",
  ...inference,
  ...over,
});

export const billRefRow = (id: string, over: Partial<Row<"lda_bill_refs">> = {}): Row<"lda_bill_refs"> => ({
  id,
  filing_id: "",
  bill_id: BILL,
  line: 1,
  section_nums: [],
  issue_code: "",
  quote: "",
  matched: "",
  how: "number",
  match: "medium",
  why: "",
  phase: "bill",
  source_url: "https://lda.senate.gov/filings/public/filing/",
  source_locator: null,
  ...over,
});
