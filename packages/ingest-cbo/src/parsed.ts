import { resolve } from "node:path";
import { python } from "@antibody/core/node";
import { z } from "zod";

const Values = z.record(z.string(), z.number().nullable());

export type Values = z.infer<typeof Values>;

const Scope = z.object({
  division: z.string().nullable(),
  title: z.string().nullable(),
  quote: z.string(),
  page: z.number(),
});

export type Scope = z.infer<typeof Scope>;

const ParsedRow = z.object({
  line: z.number().nullish(),
  sheet: z.string(),
  block: z.string().nullable(),
  line_kind: z.string(),
  division: z.string().nullish(),
  title_no: z.string().nullish(),
  marks: z.array(z.string()).optional(),
  parent: z.string().nullish(),
  scope: Scope.optional(),
  sections: z.array(z.string()),
  section_title: z.string().nullable(),
  component: z.string().nullable(),
  measure: z.string(),
  measure_kind: z.string(),
  values: Values,
  range: z.string(),
  breakdown_of_total: z.boolean().optional(),
});

export type ParsedRow = z.infer<typeof ParsedRow>;

const SourceFile = z.object({ url: z.string(), archiveUrl: z.string().nullable() });

export type SourceFile = z.infer<typeof SourceFile>;

const ParsedSheet = z.object({
  file: SourceFile.optional(),
  sheet: z.string(),
  years: z.array(z.string()),
  unit: z.string().nullish(),
  notes: z.record(z.string(), z.string()).optional(),
  rows: z.array(ParsedRow),
});

export type ParsedSheet = z.infer<typeof ParsedSheet>;

const TotalRow = z.object({
  block: z.string().nullish(),
  measure: z.string(),
  measure_kind: z.string(),
  values: Values,
  range: z.string(),
});

const Summary = z.object({
  file: SourceFile.optional(),
  sheet: z.string(),
  years: z
    .array(z.string())
    .nullable()
    .transform((years) => years ?? []),
  unit: z.string().nullish(),
  rows: z.array(TotalRow),
});

export type Summary = z.infer<typeof Summary>;

const Parsed = z.object({
  format: z.enum(["xlsx", "pdf", "table1"]),
  sheets: z.array(ParsedSheet),
  summary: Summary.nullable(),
});

export type Parsed = z.infer<typeof Parsed>;

const Glance = z.object({
  pages: z.array(z.string()),
  glance: z
    .object({
      periods: z.array(z.string()),
      rows: z.array(z.object({ label: z.string(), values: Values, raw: z.record(z.string(), z.string()) })),
    })
    .nullable(),
  mandates: z.object({ intergovernmental: z.string().nullable(), private_sector: z.string().nullable() }),
  baseline_month: z.string().nullable(),
  budget_enforcement_baseline: z.boolean(),
});

export type Glance = z.infer<typeof Glance>;

const PKG = resolve(import.meta.dir, "..");

export const readTables = async (command: "xlsx" | "pdf" | "table1" | "pages", file: string) =>
  Parsed.parse(JSON.parse(await python(PKG, "cbo.py", [command, file])));

export const readGlance = async (file: string) =>
  Glance.parse(JSON.parse(await python(PKG, "cbo.py", ["glance", file])));
