export type Values = Record<string, number | null>;

/** One printed row of a CBO table, as py/cbo.py reads it. `line` groups the rows of one CBO line item. */
export interface ParsedRow {
  line?: number;
  sheet: string;
  block: string | null;
  /** section, or a row CBO labelled by `title` (a whole title) or `program` (a provision with no section number); total, subtotal, interaction, … otherwise. */
  line_kind: string;
  /** The division letter and title numeral the row sits under in CBO's table. */
  division?: string | null;
  title_no?: string | null;
  sections: string[];
  section_title: string | null;
  component: string | null;
  measure: string;
  measure_kind: string;
  values: Values;
  range: string;
  breakdown_of_total?: boolean;
}

/** The cbo.gov file a table came from and the archive copy we read. */
export interface SourceFile {
  url: string;
  archiveUrl: string | null;
}

export interface ParsedSheet {
  file?: SourceFile;
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
  file?: SourceFile;
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
