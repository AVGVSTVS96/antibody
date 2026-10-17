import type { Row } from "@antibody/core";
import type { Glance, Parsed, ParsedRow, ParsedSheet, Scope, SourceFile, Summary, Values } from "./parsed.ts";
import type { Found, Place, Places, SectionJoin } from "./sections.ts";

type Line = Row<"cbo_lines">;
type Measure = Line["measure"];
type Spending = Line["spending"];
type Flow = "budget_authority" | "outlays" | "revenues";
type Join = NonNullable<Line["join"]>;

/**
 * A CBO line over more sections than this stays a group line: an even share of it would be noise, whether CBO
 * printed the section numbers or the line is a whole title. Every group CBO printed so far is smaller.
 */
export const EVEN_SPLIT_MAX = 8;

export interface Source {
  estimateId: string;
  billId: string;
  fileUrl: string;
  archiveUrl: string | null;
  pdfUrl: string | null;
  pdfArchiveUrl: string | null;
  /** Set when CBO scored text GovInfo doesn't publish and its section numbers were joined to the closest version's numbering. */
  numbering?: string;
  /** Set when the estimate is of another bill that carried this bill's text. */
  carried?: string;
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
const LEAF = new Set(["section", "title", "program"]);
const ADDITIVE = new Set([...LEAF, "interaction", "sequestration", "other"]);
const RECONCILED = new Set(["budget_authority", "outlays", "revenues", "off_budget_revenues"]);
const DIVISION_TOTAL = /^division\s+([a-z]+)\s+total$/i;
const BILLIONS_NOTE = "CBO prints this table in billions of dollars; shown here in millions (x 1,000)";
/** A sheet printed in billions to one decimal rounds each row to $50 million, so a total can be off by $100 million. */
const BILLIONS_ROUNDING = 100;

/**
 * Checks every title × block × measure × period: the rows that add up must equal the total CBO prints, and where
 * CBO prints a total for a whole division, the rows under that division must add up to it too.
 * The check runs against CBO's own total lines, so it isn't circular. Within $2M counts as CBO's rounding.
 */
export function reconcile(sheets: ParsedSheet[]): Reconcile {
  let checks = 0;
  let exact = 0;
  const failing = new Set<string>();
  const check = (sheet: ParsedSheet, key: string, summed: Map<string, number> | undefined, total: ParsedRow) => {
    const rounding = sheet.unit === "billions" ? BILLIONS_ROUNDING : 2;
    for (const period of sheet.years) {
      const diff = Math.round((summed?.get(period) ?? 0) - (total.values[period] ?? 0));
      checks++;
      if (diff === 0) exact++;
      if (Math.abs(diff) > rounding) failing.add(`${sheet.sheet}|${key}`);
    }
  };
  for (const sheet of sheets) {
    const leafBlocks = new Set(sheet.rows.filter((r) => LEAF.has(r.line_kind)).map((r) => r.block));
    const sums = new Map<string, Map<string, number>>();
    const divisionSums = new Map<string, Map<string, number>>();
    const totals = new Map<string, ParsedRow>();
    const divisionTotals: [string, ParsedRow][] = [];
    const add = (into: Map<string, Map<string, number>>, key: string, r: ParsedRow) => {
      const sum = into.get(key) ?? new Map<string, number>();
      for (const [period, v] of Object.entries(r.values)) sum.set(period, (sum.get(period) ?? 0) + (v ?? 0));
      into.set(key, sum);
    };
    for (const r of sheet.rows) {
      const measure = kindOf(r);
      if (!RECONCILED.has(measure)) continue;
      const kind = r.line_kind === "subtotal" && !leafBlocks.has(r.block) ? "other" : r.line_kind;
      const key = `${r.block}|${measure}`;
      if (ADDITIVE.has(kind) && !r.breakdown_of_total) {
        add(sums, key, r);
        if (LEAF.has(kind) && r.division) add(divisionSums, `${key}|${r.division}`, r);
      } else if (kind === "total") totals.set(key, r);
      else if (kind === "subtotal") {
        const division = r.section_title?.match(DIVISION_TOTAL)?.[1];
        if (division) divisionTotals.push([`${key}|${division.toUpperCase()}`, r]);
      }
    }
    for (const [key, total] of totals) check(sheet, key, sums.get(key), total);
    for (const [key, total] of divisionTotals)
      check(sheet, key.split("|").slice(0, 2).join("|"), divisionSums.get(key), total);
  }
  return { checks, exact, failing: [...failing] };
}

interface Amount {
  values: Values;
  ranges: string[];
  file: SourceFile;
  /** How the amounts were converted from what the sheet prints. */
  note?: string;
}

interface CboLine {
  key: string;
  kind: "section" | "title" | "program";
  scope?: Scope;
  /** The one bill section a footnote on the row names. */
  noted?: Noted;
  title: string | null;
  nums: string[];
  place: Place;
  flow: Flow;
  amount: Amount;
  sheet: ParsedSheet;
}

interface Part extends Amount {
  years: string[];
  title: string | null;
  even: boolean;
  restsOn: string[];
  /** The section this part belongs to when it was found without a printed number of its own. */
  sid?: string;
  join: Join;
  how: string | null;
}

/** A section CBO's row was tied to without a printed number, with how it was found. */
interface Member {
  num: string;
  division: string | null;
  sid?: string;
}

const WEAKNESS: Record<Join, number> = { number: 0, title: 1, heading: 2 };
const weakest = (joins: Join[]): Join => joins.reduce((a, b) => (WEAKNESS[b] > WEAKNESS[a] ? b : a), "number");
interface Noted {
  num: string;
  mark: string;
  quote: string;
}

/**
 * The section a footnote on a row names: the one section number in the note's first sentence, as in "Section 804
 * would allow …". A row with notes naming different sections, or none, names none.
 */
function notedSection(row: ParsedRow, notes: Record<string, string> = {}): Noted | undefined {
  const found = (row.marks ?? []).flatMap((mark) => {
    const quote = (notes[mark] ?? "").split(/(?<=\.) /)[0] ?? "";
    const nums = [...quote.matchAll(/\b[Ss]ections? (\d+[A-Z]?)(?= would|,| of title| of division| states)/g)].map(
      (m) => m[1]!,
    );
    return nums.length === 1 ? [{ num: nums[0]!, mark, quote }] : [];
  });
  return found.length === 1 ? found[0] : undefined;
}

const placeOf = (r: ParsedRow): Place =>
  r.division || r.title_no || !r.scope
    ? { division: r.division ?? null, title: r.title_no ?? null }
    : { division: r.scope.division, title: r.scope.title };
const sectionKey = (division: string | null | undefined, num: string) => (division ? `${division}.${num}` : num);
const placeText = (p: Place) =>
  [p.division && `division ${p.division}`, p.title && `title ${p.title}`].filter(Boolean).join(" ") || "the bill";

export function buildLines(
  src: Source,
  parsed: Parsed | null,
  glance: Glance | null,
  sectionId: SectionJoin,
  places?: Places,
): Built {
  const sheets = parsed?.format === "table1" ? [] : (parsed?.sheets ?? []);
  const check = reconcile(sheets);
  const failing = new Set(check.failing);
  const out: Line[] = [];
  const unmapped = new Set<string>();
  const fileOf = (x: { file?: SourceFile }) => x.file ?? { url: src.fileUrl, archiveUrl: src.archiveUrl };
  const find = (n: string, title: string | null, group: boolean, division: string | null) => {
    const id = sectionId(n, title, group, division);
    if (!id) unmapped.add(n);
    return id;
  };
  const ids = (nums: string[], title: string | null, group = false, division: string | null = null) =>
    nums.flatMap((n) => find(n, title, group, division) ?? []);

  const items: CboLine[] = [];
  for (const [i, sheet] of sheets.entries()) {
    const byLine = Map.groupBy(
      sheet.rows.filter(
        (r) =>
          (r.line_kind === "title" || r.line_kind === "program" || (r.line_kind === "section" && r.sections.length)) &&
          !r.breakdown_of_total,
      ),
      (r) => r.line ?? -1,
    );
    for (const [line, rows] of byLine)
      for (const flow of FLOWS) {
        const block = BLOCK[flow];
        let picked = rows.filter((r) => kindOf(r) === flow && r.block === block);
        if (!picked.length) picked = rows.filter((r) => PARTS[r.measure_kind] === flow && r.block === block);
        if (!picked.length || failing.has(`${sheet.sheet}|${block}|${flow}`)) continue;
        const amount = sum(picked, sheet, fileOf(sheet));
        if (last(amount.values, sheet.years) === null) continue;
        items.push({
          key: `${i}.${line}`,
          kind: rows[0]!.line_kind as CboLine["kind"],
          title: rows[0]!.section_title,
          nums: [...new Set(rows.flatMap((r) => r.sections).map(baseNum))],
          place: placeOf(rows[0]!),
          scope: rows[0]!.scope,
          noted: notedSection(rows[0]!, sheet.notes),
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
          section_ids: [],
          title: `${sheet.sheet}: ${total.measure} (section rows don't add up to this total, so they are not shown)`,
          measure: flow,
          amount: { values: total.values, ranges: [total.range], file: fileOf(sheet) },
          split: "exact",
          rests_on: [],
        }),
      );
    }
  }

  const programs = resolvePrograms(items, places);
  const parts = new Map<string, Part[]>();
  const groups = new Map<string, Map<Flow, string>>();
  const plain = (it: CboLine): Part => ({
    ...it.amount,
    years: it.sheet.years,
    title: it.title,
    even: false,
    restsOn: [],
    join: "number",
    how: null,
  });
  const group = (it: CboLine, members: Member[], join: Join, how: string | null) => {
    const years = it.sheet.years;
    const id = `${src.estimateId}:g${it.key}:${it.flow}`;
    const listed = join === "number" || members.length <= EVEN_SPLIT_MAX;
    out.push(
      line(src, years, {
        id,
        line_kind: "group",
        section_nums: listed ? members.map((m) => m.num) : [],
        section_ids: listed ? members.flatMap((m) => m.sid ?? []) : [],
        title: it.title,
        measure: it.flow,
        amount: it.amount,
        split: "exact",
        rests_on: [],
        join,
        how: listed ? how : `${how}; more than ${EVEN_SPLIT_MAX} sections, so no even share is made per section`,
      }),
    );
    groups.set(it.key, (groups.get(it.key) ?? new Map()).set(it.flow, id));
    if (members.length > EVEN_SPLIT_MAX) return;
    const share = scale(it.amount.values, 1 / members.length);
    for (const m of members)
      push(parts, `${m.division ?? ""}|${m.num}|${it.flow}`, {
        values: share,
        ranges: it.amount.ranges,
        file: it.amount.file,
        note: it.amount.note,
        years,
        title: it.title,
        even: true,
        restsOn: [`cbo_lines/${id}`],
        sid: m.sid,
        join,
        how,
      });
  };
  const unjoined = (it: CboLine) => {
    const id = `${src.estimateId}:g${it.key}:${it.flow}`;
    out.push(
      line(src, it.sheet.years, {
        id,
        line_kind: "group",
        section_nums: [],
        section_ids: [],
        title: it.title,
        measure: it.flow,
        amount: it.amount,
        split: "exact",
        rests_on: [],
        how: `no section number, and no section heading under ${placeText(it.place)} matches this row`,
      }),
    );
    groups.set(it.key, (groups.get(it.key) ?? new Map()).set(it.flow, id));
  };

  for (const it of items) {
    const sid = it.noted && it.kind !== "section" ? find(it.noted.num, it.title, false, it.place.division) : undefined;
    if (it.noted && sid) {
      const how = `CBO's note ${it.noted.mark} on this row names section ${it.noted.num}: "${it.noted.quote}"`;
      push(parts, `${it.place.division ?? ""}|${it.noted.num}|${it.flow}`, { ...plain(it), sid, how });
    } else if (it.kind === "program" && !it.scope) {
      const m = programs.get(it.key);
      if (!m) {
        unjoined(it);
        continue;
      }
      const how = `CBO printed no section number; its row matches the heading of section ${m.num} ("${m.heading}") of ${placeText(it.place)} in the ${m.version} text`;
      push(parts, `${m.division ?? ""}|${m.num}|${it.flow}`, { ...plain(it), sid: m.id, join: "heading", how });
    } else if (it.kind === "title" || it.scope) {
      const here = places?.under(it.place) ?? [];
      const size = `${placeText(it.place)}, which has ${here.length} section${here.length === 1 ? "" : "s"} in the ${here[0]?.version} text`;
      const how = it.scope
        ? `CBO's text says (page ${it.scope.page}) "${it.scope.quote}"; that is all of ${size}`
        : `CBO's row is for all of ${size}`;
      if (!here.length) unjoined(it);
      else if (here.length === 1)
        push(parts, `${here[0]!.division ?? ""}|${here[0]!.num}|${it.flow}`, {
          ...plain(it),
          sid: here[0]!.id,
          join: "title",
          how,
        });
      else
        group(
          it,
          here.map((f) => ({ num: f.num, division: f.division, sid: f.id })),
          "title",
          how,
        );
    } else if (it.nums.length === 1) push(parts, `${it.place.division ?? ""}|${it.nums[0]}|${it.flow}`, plain(it));
    else
      group(
        it,
        it.nums.map((num) => ({ num, division: it.place.division, sid: find(num, it.title, true, it.place.division) })),
        "number",
        null,
      );
  }

  const sectionLines = new Map<string, Map<Flow, Line>>();
  for (const [key, ps] of parts) {
    const [division, num, flow] = key.split("|") as [string, string, Flow];
    const own = sectionKey(division || null, num);
    const sid = ps.find((p) => p.sid)?.sid;
    const section_ids = sid ? [sid] : ids([num], ps[0]!.title, false, division || null);
    const row = line(src, ps[0]!.years, {
      id: `${src.estimateId}:s${own}:${flow}`,
      line_kind: "section",
      section_nums: [num],
      section_ids,
      title: ps[0]!.title,
      measure: flow,
      amount: {
        values: addValues(ps.map((p) => p.values)),
        ranges: ps.flatMap((p) => p.ranges),
        file: ps[0]!.file,
        note: ps.find((p) => p.note)?.note,
      },
      split: ps.some((p) => p.even) ? "even_split" : "exact",
      rests_on: [...new Set(ps.flatMap((p) => p.restsOn))],
      join: section_ids.length ? weakest(ps.map((p) => p.join)) : null,
      how: [...new Set(ps.flatMap((p) => p.how ?? []))].join("; ") || null,
    });
    out.push(row);
    const m = sectionLines.get(own) ?? new Map<Flow, Line>();
    m.set(flow, row);
    sectionLines.set(own, m);
  }

  for (const [own, m] of sectionLines) {
    const d = deficit(`${src.estimateId}:s${own}:deficit`, m.get("outlays"), m.get("revenues"));
    if (d) out.push(d);
  }
  const byId = new Map(out.map((l) => [l.id, l]));
  for (const [key, g] of groups) {
    const outlays = g.get("outlays");
    const revenues = g.get("revenues");
    const d = deficit(
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
 * The section each program row (a provision CBO labelled without a number) is about, by heading. A section that two
 * different rows would both claim is claimed by neither: the label alone can't tell them apart.
 */
function resolvePrograms(items: CboLine[], places?: Places) {
  const found = new Map<string, Found>();
  if (!places) return found;
  for (const it of items)
    if (it.kind === "program" && !found.has(it.key)) {
      const m = places.heading(it.title ?? "", it.place);
      if (m) found.set(it.key, m);
    }
  const claims = Map.groupBy(found.entries(), ([, m]) => m.id);
  for (const [, claimants] of claims) if (claimants.length > 1) for (const [key] of claimants) found.delete(key);
  return found;
}

/**
 * A section's deficit effect: outlays minus revenues (positive adds to the deficit). It is derived, so it
 * rests on both lines and cites every cell range they add up.
 */
function deficit(id: string, outlays?: Line, revenues?: Line): Line | null {
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
    join: both.some((l) => l.join) ? weakest(both.flatMap((l) => l.join ?? [])) : null,
    rests_on: both.map((l) => `cbo_lines/${l.id}`),
    source_locator: [
      ...new Set(
        both.map((l) =>
          l.source_url === base.source_url ? l.source_locator : `${fileName(l.source_url)}: ${l.source_locator}`,
        ),
      ),
    ].join("; "),
  };
}

const WHOLE: [RegExp, Measure | null, Spending][] = [
  [/authorization/i, null, null],
  [/nonscorable/i, "nonscorable_revenues", null],
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
    if (re.test(text)) return !measure || /on-budget|off-budget/i.test(text) ? null : [measure, spending];
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
    file: SourceFile,
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
      join: null,
      archive_url: file.archiveUrl,
      rests_on: [],
      source_url: file.url,
      source_locator: [where, src.carried].filter(Boolean).join("; "),
    });
  };
  const summaryFile = summary?.file ?? { url: src.fileUrl, archiveUrl: src.archiveUrl };
  for (const r of summary?.rows ?? [])
    add(
      r.measure,
      r.block,
      r.values,
      summary!.years,
      summaryFile,
      [locator([r.range]), summary!.unit === "billions" && BILLIONS_NOTE].filter(Boolean).join("; "),
    );
  if (glance?.glance && src.pdfUrl)
    for (const r of glance.glance.rows)
      add(
        r.label,
        null,
        r.values,
        glance.glance.periods,
        { url: src.pdfUrl, archiveUrl: src.pdfArchiveUrl },
        "page 1, At a Glance table",
      );
  return [...out.values()];
}

function line(
  src: Source,
  years: string[],
  l: Pick<Line, "id" | "line_kind" | "section_nums" | "section_ids" | "title" | "measure" | "split" | "rests_on"> & {
    amount: Amount;
    join?: Join | null;
    /** What a heading or title join rests on, or why a row is not tied to a section. */
    how?: string | null;
  },
): Line {
  const { amount, how, join, ...rest } = l;
  const period = years.at(-1)!;
  return {
    ...rest,
    join: join ?? null,
    estimate_id: src.estimateId,
    bill_id: src.billId,
    spending: l.measure === "revenues" || l.measure === "deficit" ? null : "direct",
    period,
    total_musd: amount.values[period] ?? 0,
    values: amount.values,
    archive_url: amount.file.archiveUrl,
    source_url: amount.file.url,
    source_locator: [locator(amount.ranges), amount.note, how, src.carried, l.section_ids.length ? src.numbering : null]
      .filter(Boolean)
      .join("; "),
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

function sum(rows: ParsedRow[], sheet: ParsedSheet, file: SourceFile): Amount {
  return {
    values: addValues(rows.map((r) => pick(r.values, sheet.years))),
    ranges: rows.map((r) => r.range),
    file,
    ...(sheet.unit === "billions" && { note: BILLIONS_NOTE }),
  };
}

function fileName(url: string): string {
  return decodeURIComponent(url.split("/").at(-1) ?? url);
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
