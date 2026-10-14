export type Values = Record<string, number | null>;

/** One printed row of a CBO table, as py/cbo.py reads it. `line` groups the rows of one CBO line item. */
export interface ParsedRow {
  line?: number;
  sheet: string;
  block: string | null;
  line_kind: string;
  sections: string[];
  section_title: string | null;
  component: string | null;
  measure: string;
  measure_kind: string;
  values: Values;
  range: string;
  breakdown_of_total?: boolean;
}

export interface ParsedSheet {
  sheet: string;
  years: string[];
  rows: ParsedRow[];
}

export interface TotalRow {
  block?: string | null;
  measure: string;
  measure_kind: string;
  values: Values;
  range: string;
}

/** Whole-bill totals: an Excel Summary sheet, a small bill's table1.xlsx, or a PDF's summary pages. */
export interface Summary {
  sheet: string;
  years: string[];
  rows: TotalRow[];
}

export interface Parsed {
  format: "xlsx" | "pdf" | "table1";
  sheets: ParsedSheet[];
  summary: Summary | null;
}

export interface Glance {
  pages: string[];
  glance: { periods: string[]; rows: { label: string; values: Values; raw: Record<string, string> }[] } | null;
  mandates: { intergovernmental: string | null; private_sector: string | null };
  baseline_month: string | null;
  budget_enforcement_baseline: boolean;
}
