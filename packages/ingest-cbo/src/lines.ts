import type { Row } from "@antibody/core";
import type { Glance, Parsed, ParsedRow, ParsedSheet, Summary, Values } from "./parsed.ts";

type Line = Row<"cbo_lines">;
type Measure = Line["measure"];
type Spending = Line["spending"];
type Flow = "budget_authority" | "outlays" | "revenues";

export interface Source {
  estimateId: string;
  billId: string;
  fileUrl: string;
  archiveUrl: string | null;
  pdfUrl: string | null;
  pdfArchiveUrl: string | null;
}

export interface Reconcile {
  checks: number;
  exact: number;
  /** `sheet|block|measure` keys whose section rows don't add up to CBO's printed total. */
  failing: string[];
}

export interface Built {
  lines: Line[];
  reconcile: Reconcile;
  /** CBO section numbers with no section in the version CBO scored. */
  unmapped: string[];
}

const FLOWS: Flow[] = ["budget_authority", "outlays", "revenues"];
const PARTS: Record<string, Flow> = {
  on_budget_outlays: "outlays",
  off_budget_outlays: "outlays",
  on_budget_revenues: "revenues",
  off_budget_revenues: "revenues",
};
const BLOCK: Record<Flow, string> = {
  budget_authority: "direct_spending",
  outlays: "direct_spending",
  revenues: "revenues",
};
const ADDITIVE = new Set(["section", "interaction", "sequestration", "other"]);
const RECONCILED = new Set(["budget_authority", "outlays", "revenues", "off_budget_revenues"]);

/**
 * Checks every title × block × measure × period: the rows that add up must equal the total CBO prints.
 * The check runs against CBO's own total lines, so it isn't circular. Within $2M counts as CBO's rounding.
 */
export function reconcile(sheets: ParsedSheet[]): Reconcile {
  let checks = 0;
  let exact = 0;
  const failing = new Set<string>();
  for (const sheet of sheets) {
    const leafBlocks = new Set(sheet.rows.filter((r) => r.line_kind === "section").map((r) => r.block));
    const sums = new Map<string, Map<string, number>>();
    const totals = new Map<string, ParsedRow>();
    for (const r of sheet.rows) {
      const measure = kindOf(r);
      if (!RECONCILED.has(measure)) continue;
      const kind = r.line_kind === "subtotal" && !leafBlocks.has(r.block) ? "other" : r.line_kind;
      const key = `${r.block}|${measure}`;
      if (ADDITIVE.has(kind) && !r.breakdown_of_total) {
        const sum = sums.get(key) ?? new Map<string, number>();
        for (const [period, v] of Object.entries(r.values)) sum.set(period, (sum.get(period) ?? 0) + (v ?? 0));
        sums.set(key, sum);
      } else if (kind === "total") totals.set(key, r);
    }
    for (const [key, total] of totals)
      for (const period of sheet.years) {
        const diff = Math.round((sums.get(key)?.get(period) ?? 0) - (total.values[period] ?? 0));
        checks++;
        if (diff === 0) exact++;
        if (Math.abs(diff) > 2) failing.add(`${sheet.sheet}|${key}`);
      }
  }
  return { checks, exact, failing: [...failing] };
}

interface Amount {
  values: Values;
  ranges: string[];
}

interface CboLine {
  key: string;
  title: string | null;
  nums: string[];
  flow: Flow;
  amount: Amount;
  sheet: ParsedSheet;
}

interface Part extends Amount {
  years: string[];
  title: string | null;
  even: boolean;
  restsOn: string[];
}

export function buildLines(
  src: Source,
  parsed: Parsed | null,
  glance: Glance | null,
  sectionId: (num: string) => string | undefined,
): Built {
  const sheets = parsed?.format === "table1" ? [] : (parsed?.sheets ?? []);
  const check = reconcile(sheets);
  const failing = new Set(check.failing);
  const out: Line[] = [];
  const unmapped = new Set<string>();
  const ids = (nums: string[]) =>
    nums.flatMap((n) => {
      const id = sectionId(n);
      if (!id) unmapped.add(n);
      return id ? [id] : [];
    });

  const items: CboLine[] = [];
  for (const [i, sheet] of sheets.entries()) {
    const byLine = Map.groupBy(
      sheet.rows.filter((r) => r.line_kind === "section" && r.sections.length && !r.breakdown_of_total),
      (r) => r.line ?? -1,
    );
    for (const [line, rows] of byLine)
      for (const flow of FLOWS) {
        const block = BLOCK[flow];
        let picked = rows.filter((r) => kindOf(r) === flow && r.block === block);
        if (!picked.length) picked = rows.filter((r) => PARTS[r.measure_kind] === flow && r.block === block);
        if (!picked.length || failing.has(`${sheet.sheet}|${block}|${flow}`)) continue;
        const amount = sum(picked, sheet.years);
        if (last(amount.values, sheet.years) === null) continue;
        items.push({
          key: `${i}.${line}`,
          title: rows[0]!.section_title,
          nums: [...new Set(rows.flatMap((r) => r.sections).map(baseNum))],
          flow,
          amount,
          sheet,
        });
      }
    for (const key of failing) {
      const [name, block, flow] = key.split("|") as [string, string, Flow];
      if (name !== sheet.sheet || !FLOWS.includes(flow)) continue;
      const total = sheet.rows.find((r) => r.line_kind === "total" && r.block === block && r.measure_kind === flow);
      if (!total) continue;
      const nums = [
        ...new Set(sheet.rows.filter((r) => r.line_kind === "section" && r.block === block).flatMap((r) => r.sections)),
      ].map(baseNum);
      out.push(
        line(src, sheet.years, {
          id: `${src.estimateId}:t${i}:${flow}`,
          line_kind: "group",
          section_nums: [...new Set(nums)],
          section_ids: ids([...new Set(nums)]),
          title: `${sheet.sheet}: ${total.measure} (section rows don't add up to this total, so they are not shown)`,
          measure: flow,
          amount: { values: total.values, ranges: [total.range] },
          split: "exact",
          rests_on: [],
        }),
      );
    }
  }

  const parts = new Map<string, Part[]>();
  const groups = new Map<string, Map<Flow, string>>();
  for (const it of items) {
    const years = it.sheet.years;
    if (it.nums.length === 1) {
      push(parts, `${it.nums[0]}|${it.flow}`, { ...it.amount, years, title: it.title, even: false, restsOn: [] });
      continue;
    }
    const id = `${src.estimateId}:g${it.key}:${it.flow}`;
    out.push(
      line(src, years, {
        id,
        line_kind: "group",
        section_nums: it.nums,
        section_ids: ids(it.nums),
        title: it.title,
        measure: it.flow,
        amount: it.amount,
        split: "exact",
        rests_on: [],
      }),
    );
    groups.set(it.key, (groups.get(it.key) ?? new Map()).set(it.flow, id));
    const share = scale(it.amount.values, 1 / it.nums.length);
    for (const n of it.nums)
      push(parts, `${n}|${it.flow}`, {
        values: share,
        ranges: it.amount.ranges,
        years,
        title: it.title,
        even: true,
        restsOn: [`cbo_lines/${id}`],
      });
  }

  const sectionLines = new Map<string, Map<Flow, Line>>();
  for (const [key, ps] of parts) {
    const [num, flow] = key.split("|") as [string, Flow];
    const row = line(src, ps[0]!.years, {
      id: `${src.estimateId}:s${num}:${flow}`,
      line_kind: "section",
      section_nums: [num],
      section_ids: ids([num]),
      title: ps[0]!.title,
      measure: flow,
      amount: { values: addValues(ps.map((p) => p.values)), ranges: ps.flatMap((p) => p.ranges) },
      split: ps.some((p) => p.even) ? "even_split" : "exact",
      rests_on: [...new Set(ps.flatMap((p) => p.restsOn))],
    });
    out.push(row);
    const m = sectionLines.get(num) ?? new Map<Flow, Line>();
    m.set(flow, row);
    sectionLines.set(num, m);
  }

  for (const [num, m] of sectionLines) {
    const d = deficit(src, `${src.estimateId}:s${num}:deficit`, m.get("outlays"), m.get("revenues"));
    if (d) out.push(d);
  }
  const byId = new Map(out.map((l) => [l.id, l]));
  for (const [key, g] of groups) {
    const outlays = g.get("outlays");
    const revenues = g.get("revenues");
    const d = deficit(
      src,
      `${src.estimateId}:g${key}:deficit`,
      outlays ? byId.get(outlays) : undefined,
      revenues ? byId.get(revenues) : undefined,
    );
    if (d) out.push(d);
  }

  out.push(...wholeBill(src, parsed?.summary ?? null, glance));
  return { lines: out, reconcile: check, unmapped: [...unmapped].sort() };
}

/**
 * A section's deficit effect: outlays minus revenues (positive adds to the deficit). It is derived, so it
 * rests on both lines and cites every cell range they add up.
 */
function deficit(src: Source, id: string, outlays?: Line, revenues?: Line): Line | null {
  if (!outlays && !revenues) return null;
  const base = (outlays ?? revenues)!;
  const keys = Object.keys(base.values);
  const values: Values = {};
  for (const k of keys) {
    const o = (outlays?.values[k] as number | null | undefined) ?? null;
    const r = (revenues?.values[k] as number | null | undefined) ?? null;
    values[k] = o === null && r === null ? null : round((o ?? 0) - (r ?? 0));
  }
  const both = [outlays, revenues].filter((l): l is Line => !!l);
  return {
    ...base,
    id,
    measure: "deficit",
    spending: null,
    total_musd: values[base.period] ?? 0,
    values,
    split: both.some((l) => l.split === "even_split") ? "even_split" : "exact",
    rests_on: both.map((l) => `cbo_lines/${l.id}`),
    source_locator: both.map((l) => l.source_locator).join("; "),
    archive_url: src.archiveUrl,
  };
}

const WHOLE: [RegExp, Measure, Spending][] = [
  [/subject to appropriation.*outlays/i, "outlays", "discretionary"],
  [/subject to appropriation/i, "budget_authority", "discretionary"],
  [/on-budget|off-budget/i, "deficit", null],
  [/deficit/i, "deficit", null],
  [/revenues/i, "revenues", null],
  [/budget authority/i, "budget_authority", "direct"],
  [/outlays/i, "outlays", "direct"],
];

function classify(label: string, block?: string | null): [Measure, Spending] | null {
  const text = block === "discretionary" ? `subject to appropriation ${label}` : label;
  for (const [re, measure, spending] of WHOLE)
    if (re.test(text)) return /on-budget|off-budget/i.test(text) ? null : [measure, spending];
  return null;
}

/** Whole-bill totals as CBO prints them: the Summary sheet or table, plus the At a Glance box for what it adds. */
function wholeBill(src: Source, summary: Summary | null, glance: Glance | null): Line[] {
  const out = new Map<string, Line>();
  const add = (
    label: string,
    block: string | null | undefined,
    values: Values,
    years: string[],
    url: string,
    where: string,
  ) => {
    const kind = classify(label, block);
    if (!kind) return;
    const [measure, spending] = kind;
    const key = `${measure}${spending === "discretionary" ? ":discretionary" : ""}`;
    if (out.has(key)) return;
    const period = [...years].reverse().find((y) => values[y] !== null && values[y] !== undefined);
    if (!period) return;
    out.set(key, {
      id: `${src.estimateId}:bill:${key}`,
      estimate_id: src.estimateId,
      bill_id: src.billId,
      line_kind: "whole-bill",
      section_nums: [],
      section_ids: [],
      title: label,
      measure,
      spending,
      period,
      total_musd: values[period]!,
      values,
      split: "exact",
      archive_url: url === src.fileUrl ? src.archiveUrl : src.pdfArchiveUrl,
      rests_on: [],
      source_url: url,
      source_locator: where,
    });
  };
  for (const r of summary?.rows ?? [])
    add(r.measure, r.block, r.values, summary!.years, src.fileUrl, locator([r.range]));
  if (glance?.glance && src.pdfUrl)
    for (const r of glance.glance.rows)
      add(r.label, null, r.values, glance.glance.periods, src.pdfUrl, "page 1, At a Glance table");
  return [...out.values()];
}

function line(
  src: Source,
  years: string[],
  l: Pick<Line, "id" | "line_kind" | "section_nums" | "section_ids" | "title" | "measure" | "split" | "rests_on"> & {
    amount: Amount;
  },
): Line {
  const { amount, ...rest } = l;
  const period = years.at(-1)!;
  return {
    ...rest,
    estimate_id: src.estimateId,
    bill_id: src.billId,
    spending: l.measure === "revenues" || l.measure === "deficit" ? null : "direct",
    period,
    total_musd: amount.values[period] ?? 0,
    values: amount.values,
    archive_url: src.archiveUrl,
    source_url: src.fileUrl,
    source_locator: locator(amount.ranges),
  };
}

/** `'Title VII'!A19:O21` + `'Title VII'!A374:O375` → `Title VII sheet, cells A19:O21 and A374:O375`; PDF pages pass through. */
export function locator(ranges: string[]): string {
  const bySheet = new Map<string, string[]>();
  const other: string[] = [];
  for (const r of new Set(ranges)) {
    const m = r.match(/^'(.+)'!(.+)$/);
    if (m) bySheet.set(m[1]!, [...(bySheet.get(m[1]!) ?? []), m[2]!]);
    else other.push(r);
  }
  const sheets = [...bySheet].map(([s, cells]) => `${s} sheet, cells ${cells.join(" and ")}`);
  return [...sheets, ...other].join("; ");
}

/**
 * In a revenues block CBO prints one row per section, so a data row whose label is the end of a wrapped
 * section title ("…Oversight Board") is that section's revenue row.
 */
function kindOf(r: ParsedRow): string {
  return r.measure_kind === "other" && r.block === "revenues" && r.line_kind === "section"
    ? "revenues"
    : r.measure_kind;
}

export function baseNum(ref: string): string {
  return ref.match(/^\d+[A-Z]?/)?.[0] ?? ref;
}

function sum(rows: ParsedRow[], years: string[]): Amount {
  return { values: addValues(rows.map((r) => pick(r.values, years))), ranges: rows.map((r) => r.range) };
}

function pick(values: Values, years: string[]): Values {
  return Object.fromEntries(years.map((y) => [y, values[y] ?? null]));
}

function addValues(all: Values[]): Values {
  const out: Values = {};
  for (const v of all)
    for (const [k, x] of Object.entries(v))
      out[k] = x === null && (out[k] ?? null) === null ? null : round((out[k] ?? 0) + (x ?? 0));
  return out;
}

function scale(values: Values, f: number): Values {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === null ? null : round(v * f)]));
}

function last(values: Values, years: string[]): number | null {
  return values[years.at(-1)!] ?? null;
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  m.set(k, [...(m.get(k) ?? []), v]);
}
