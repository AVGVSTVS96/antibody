import type { Row } from "@antibody/core";
import { filled, must } from "@antibody/core";
import type { Glance, Parsed, ParsedRow, ParsedSheet, Scope, SourceFile, Summary, Values } from "./parsed.ts";
import type { Found, Place, Places, SectionJoin } from "./sections.ts";

type Line = Row<"cbo_lines">;

type Measure = Line["measure"];

type Spending = Line["spending"];

type Flow = "budget_authority" | "outlays" | "revenues";

type Join = NonNullable<Line["join"]>;

export const EVEN_SPLIT_MAX = 8;

export interface Source {
  estimateId: string;
  billId: string;
  fileUrl: string;
  archiveUrl: string | null;
  pdfUrl: string | null;
  pdfArchiveUrl: string | null;
  numbering: string | null;
  carried: string | null;
}

export interface Reconcile {
  checks: number;
  exact: number;
  failing: string[];
  confirmed: string[];
}

export interface Built {
  lines: Line[];
  reconcile: Reconcile;
  unmapped: string[];
}

const FLOWS: Flow[] = ["budget_authority", "outlays", "revenues"];

const PARTS = new Map<string, Flow>([
  ["on_budget_outlays", "outlays"],
  ["off_budget_outlays", "outlays"],
  ["on_budget_revenues", "revenues"],
  ["off_budget_revenues", "revenues"],
]);

const BLOCK: Record<Flow, string> = {
  budget_authority: "direct_spending",
  outlays: "direct_spending",
  revenues: "revenues",
};

const LEAF = new Set(["section", "title", "program"]);
const ADDITIVE = new Set([...LEAF, "interaction", "sequestration", "other"]);
const RECONCILED = new Set(["budget_authority", "outlays", "revenues", "off_budget_revenues"]);
const DIVISION_TOTAL = /^division\s+([a-z]+)\s+total$/iu;
const BILLIONS_NOTE = "CBO prints this table in billions of dollars; shown here in millions (x 1,000)";

const BILLIONS_ROUNDING = 100;

const addInto = (into: Map<string, Map<string, number>>, key: string, r: ParsedRow) => {
  const bucket = into.get(key) ?? new Map<string, number>();

  for (const [period, v] of Object.entries(r.values)) {
    bucket.set(period, (bucket.get(period) ?? 0) + (v ?? 0));
  }

  into.set(key, bucket);
};

export function reconcile(sheets: ParsedSheet[]): Reconcile {
  let checks = 0;
  let exact = 0;
  const failing = new Set<string>();
  const totalled = new Set<string>();

  const check = (sheet: ParsedSheet, key: string, summed: Map<string, number> | undefined, total: ParsedRow) => {
    const rounding = sheet.unit === "billions" ? BILLIONS_ROUNDING : 2;
    totalled.add(`${sheet.sheet}|${key}`);

    for (const period of sheet.years) {
      const diff = Math.round((summed?.get(period) ?? 0) - (total.values[period] ?? 0));
      checks++;

      if (diff === 0) {
        exact++;
      }

      if (Math.abs(diff) > rounding) {
        failing.add(`${sheet.sheet}|${key}`);
      }
    }
  };

  for (const sheet of sheets) {
    const leafBlocks = new Set(sheet.rows.filter((r) => LEAF.has(r.line_kind)).map((r) => r.block));
    const sums = new Map<string, Map<string, number>>();
    const divisionSums = new Map<string, Map<string, number>>();
    const totals = new Map<string, ParsedRow>();
    const divisionTotals: [string, ParsedRow][] = [];

    for (const r of sheet.rows) {
      const measure = kindOf(r);

      if (!RECONCILED.has(measure)) {
        continue;
      }

      const kind = r.line_kind === "subtotal" && !leafBlocks.has(r.block) ? "other" : r.line_kind;
      const key = `${r.block}|${measure}`;

      if (ADDITIVE.has(kind) && r.breakdown_of_total !== true) {
        addInto(sums, key, r);

        if (LEAF.has(kind) && filled(r.division)) {
          addInto(divisionSums, `${key}|${r.division}`, r);
        }
      } else if (kind === "total" && !totals.has(key)) {
        totals.set(key, r);
      } else if (kind === "subtotal") {
        const division = r.section_title?.match(DIVISION_TOTAL)?.[1];

        if (division !== undefined) {
          divisionTotals.push([`${key}|${division.toUpperCase()}`, r]);
        }
      }
    }

    for (const [key, total] of totals) {
      check(sheet, key, sums.get(key), total);
    }

    for (const [key, total] of divisionTotals) {
      check(sheet, key.split("|").slice(0, 2).join("|"), divisionSums.get(key), total);
    }
  }

  const confirmed = new Set(totalled);

  for (const key of failing) {
    confirmed.delete(key);
  }

  return { checks, exact, failing: [...failing], confirmed: [...confirmed] };
}

interface Amount {
  values: Values;
  ranges: string[];
  file: SourceFile;
  note: string | null;
}

interface CboLine {
  key: string;
  kind: "section" | "title" | "program";
  scope: Scope | undefined;
  noted: Noted | undefined;
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
  sid: string | undefined;
  join: Join;
  how: string | null;
}

interface Member {
  num: string;
  division: string | null;
  sid: string | undefined;
}

const WEAKNESS: Record<Join, number> = { number: 0, title: 1, heading: 2 };
const weakest = (joins: Join[]): Join => joins.reduce((a, b) => (WEAKNESS[b] > WEAKNESS[a] ? b : a), "number");

interface Noted {
  num: string;
  mark: string;
  quote: string;
}

function notedSection(row: ParsedRow, notes: Record<string, string> = {}): Noted | undefined {
  const found = (row.marks ?? []).flatMap((mark) => {
    const quote = (notes[mark] ?? "").split(/(?<=\.) /u)[0] ?? "";

    const nums = [...quote.matchAll(/\b[Ss]ections? (\d+[A-Z]?)(?= would|,| of title| of division| states)/gu)].map(
      (m) => m[1] ?? "",
    );

    const [num] = nums;

    return nums.length === 1 && num !== undefined ? [{ num, mark, quote }] : [];
  });

  return found.length === 1 ? found[0] : undefined;
}

const placeOf = (r: ParsedRow): Place =>
  filled(r.division) || filled(r.title_no) || !r.scope
    ? { division: r.division ?? null, title: r.title_no ?? null }
    : { division: r.scope.division, title: r.scope.title };

const sectionKey = (division: string | null | undefined, num: string) =>
  filled(division) ? `${division}.${num}` : num;

const placeText = (p: Place) =>
  [filled(p.division) ? `division ${p.division}` : "", filled(p.title) ? `title ${p.title}` : ""]
    .filter((x) => x !== "")
    .join(" ") || "the bill";

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
  const fileOf = (x: { file?: SourceFile | undefined }) => x.file ?? { url: src.fileUrl, archiveUrl: src.archiveUrl };

  const find = (n: string, title: string | null, group: boolean, division: string | null) => {
    const id = sectionId(n, title, group, division);

    if (id === undefined) {
      unmapped.add(n);
    }

    return id;
  };

  const ids = (nums: string[], title: string | null, group = false, division: string | null = null) =>
    nums.flatMap((n) => find(n, title, group, division) ?? []);

  const confirmed = new Set(check.confirmed);

  const vouched = (sheet: ParsedSheet, block: string, flow: Flow) =>
    confirmed.has(`${sheet.sheet}|${block}|${flow}`) ||
    new Set(sheet.rows.filter((r) => LEAF.has(r.line_kind) && r.block === block).map((r) => r.line)).size === 1;

  const items: CboLine[] = [];

  for (const [i, sheet] of sheets.entries()) {
    const byLine = Map.groupBy(
      sheet.rows.filter(
        (r) =>
          (r.line_kind === "title" ||
            r.line_kind === "program" ||
            (r.line_kind === "section" && r.sections.length > 0)) &&
          r.breakdown_of_total !== true,
      ),
      (r) => r.line ?? -1,
    );

    for (const [lineNo, rows] of byLine) {
      const head = must(rows[0], "a row of a grouped line");
      const kind = head.line_kind;

      if (kind !== "section" && kind !== "title" && kind !== "program") {
        continue;
      }

      for (const flow of FLOWS) {
        const block = BLOCK[flow];
        let picked = rows.filter((r) => kindOf(r) === flow && r.block === block);

        if (!picked.length) {
          picked = rows.filter((r) => PARTS.get(r.measure_kind) === flow && r.block === block);
        }

        if (!picked.length || failing.has(`${sheet.sheet}|${block}|${flow}`)) {
          continue;
        }

        if (kind !== "section" && !vouched(sheet, block, flow)) {
          continue;
        }

        const amount = sum(picked, sheet, fileOf(sheet));

        if (last(amount.values, sheet.years) === null) {
          continue;
        }

        items.push({
          key: `${i}.${lineNo}`,
          kind,
          title: head.section_title,
          nums: [...new Set(rows.flatMap((r) => r.sections).map(baseNum))],
          place: placeOf(head),
          scope: head.scope,
          noted: notedSection(head, sheet.notes),
          flow,
          amount,
          sheet,
        });
      }
    }

    for (const key of failing) {
      const [name, block, measure] = key.split("|");
      const flow = FLOWS.find((f) => f === measure);

      if (name !== sheet.sheet || flow === undefined) {
        continue;
      }

      const total = sheet.rows.find((r) => r.line_kind === "total" && r.block === block && r.measure_kind === flow);

      if (!total) {
        continue;
      }

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
          amount: { values: total.values, ranges: [total.range], file: fileOf(sheet), note: null },
          split: "exact",
          rests_on: [],
        }),
      );
    }
  }

  const programs = resolvePrograms(items, places);
  const parts = new Map<string, { division: string | null; num: string; flow: Flow; ps: Part[] }>();
  const groups = new Map<string, Map<Flow, string>>();

  const addPart = (division: string | null, num: string, flow: Flow, part: Part) => {
    const key = `${division ?? ""}|${num}|${flow}`;
    const entry = parts.get(key) ?? { division: filled(division) ? division : null, num, flow, ps: [] };
    entry.ps.push(part);
    parts.set(key, entry);
  };

  const plain = (it: CboLine): Part => ({
    ...it.amount,
    years: it.sheet.years,
    title: it.title,
    even: false,
    restsOn: [],
    sid: undefined,
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
    groups.set(it.key, (groups.get(it.key) ?? new Map<Flow, string>()).set(it.flow, id));

    if (members.length > EVEN_SPLIT_MAX) {
      return;
    }

    const share = scale(it.amount.values, 1 / members.length);

    for (const m of members) {
      addPart(m.division, m.num, it.flow, {
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
    }
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
    groups.set(it.key, (groups.get(it.key) ?? new Map<Flow, string>()).set(it.flow, id));
  };

  for (const it of items) {
    const sid = it.noted && it.kind !== "section" ? find(it.noted.num, it.title, false, it.place.division) : undefined;

    if (it.noted && sid !== undefined) {
      const how = `CBO's note ${it.noted.mark} on this row names section ${it.noted.num}: "${it.noted.quote}"`;
      addPart(it.place.division, it.noted.num, it.flow, { ...plain(it), sid, how });
    } else if (it.kind === "program" && !it.scope) {
      const m = programs.get(it.key);

      if (!m) {
        unjoined(it);
        continue;
      }

      const how = `CBO printed no section number; its row matches the heading of section ${m.num} ("${m.heading}") of ${placeText(it.place)} in the ${m.version} text`;
      addPart(m.division, m.num, it.flow, { ...plain(it), sid: m.id, join: "heading", how });
    } else if (it.kind === "title" || it.scope) {
      const here = places?.under(it.place) ?? [];
      const size = `${placeText(it.place)}, which has ${here.length} section${here.length === 1 ? "" : "s"} in the ${here[0]?.version} text`;

      const how = it.scope
        ? `CBO's text says (page ${it.scope.page}) "${it.scope.quote}"; that is all of ${size}`
        : `CBO's row is for all of ${size}`;

      const [first] = here;

      if (!first) {
        unjoined(it);
      } else if (here.length === 1) {
        addPart(first.division, first.num, it.flow, {
          ...plain(it),
          sid: first.id,
          join: "title",
          how,
        });
      } else {
        group(
          it,
          here.map((f) => ({ num: f.num, division: f.division, sid: f.id })),
          "title",
          how,
        );
      }
    } else if (it.nums.length === 1 && it.nums[0] !== undefined) {
      addPart(it.place.division, it.nums[0], it.flow, plain(it));
    } else {
      group(
        it,
        it.nums.map((num) => ({ num, division: it.place.division, sid: find(num, it.title, true, it.place.division) })),
        "number",
        null,
      );
    }
  }

  const sectionLines = new Map<string, Map<Flow, Line>>();

  for (const { division, num, flow, ps } of parts.values()) {
    const head = must(ps[0], "a part of a section line");
    const own = sectionKey(division, num);
    const sid = ps.find((p) => filled(p.sid))?.sid;
    const section_ids = filled(sid) ? [sid] : ids([num], head.title, false, division);

    const row = line(src, head.years, {
      id: `${src.estimateId}:s${own}:${flow}`,
      line_kind: "section",
      section_nums: [num],
      section_ids,
      title: head.title,
      measure: flow,
      amount: {
        values: addValues(ps.map((p) => p.values)),
        ranges: ps.flatMap((p) => p.ranges),
        file: head.file,
        note: ps.find((p) => filled(p.note))?.note ?? null,
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

    if (d) {
      out.push(d);
    }
  }

  const byId = new Map(out.map((l) => [l.id, l]));

  for (const [key, g] of groups) {
    const outlays = g.get("outlays");
    const revenues = g.get("revenues");

    const d = deficit(
      `${src.estimateId}:g${key}:deficit`,
      outlays === undefined ? undefined : byId.get(outlays),
      revenues === undefined ? undefined : byId.get(revenues),
    );

    if (d) {
      out.push(d);
    }
  }

  out.push(...wholeBill(src, parsed?.summary ?? null, glance));

  return { lines: out, reconcile: check, unmapped: [...unmapped].toSorted() };
}

function resolvePrograms(items: CboLine[], places?: Places) {
  const found = new Map<string, Found>();

  if (!places) {
    return found;
  }

  for (const it of items) {
    if (it.kind === "program" && !found.has(it.key)) {
      const m = places.heading(it.title ?? "", it.place);

      if (m) {
        found.set(it.key, m);
      }
    }
  }

  const claims = Map.groupBy(found.entries(), ([, m]) => m.id);

  for (const [, claimants] of claims) {
    if (claimants.length > 1) {
      for (const [key] of claimants) {
        found.delete(key);
      }
    }
  }

  return found;
}

const isNumber = (value: unknown): value is number => typeof value === "number";

const valueAt = (l: Line | undefined, k: string) => {
  const v = l?.values[k];

  return isNumber(v) ? v : null;
};

function deficit(id: string, outlays?: Line, revenues?: Line): Line | null {
  const base = outlays ?? revenues;

  if (!base) {
    return null;
  }

  const keys = Object.keys(base.values);
  const values: Values = {};

  for (const k of keys) {
    const o = valueAt(outlays, k);
    const r = valueAt(revenues, k);
    values[k] = o === null && r === null ? null : round((o ?? 0) - (r ?? 0));
  }

  const both = [outlays, revenues].filter((l) => l !== undefined);

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
  [/authorization/iu, null, null],
  [/nonscorable/iu, "nonscorable_revenues", null],
  [/subject to appropriation.*outlays/iu, "outlays", "discretionary"],
  [/subject to appropriation/iu, "budget_authority", "discretionary"],
  [/on-budget|off-budget/iu, "deficit", null],
  [/deficit/iu, "deficit", null],
  [/revenues/iu, "revenues", null],
  [/budget authority/iu, "budget_authority", "direct"],
  [/outlays/iu, "outlays", "direct"],
];

function classify(label: string, block?: string | null): [Measure, Spending] | null {
  const text = block === "discretionary" ? `subject to appropriation ${label}` : label;

  for (const [re, measure, spending] of WHOLE) {
    if (re.test(text)) {
      return !measure || /on-budget|off-budget/iu.test(text) ? null : [measure, spending];
    }
  }

  return null;
}

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

    if (!kind) {
      return;
    }

    const [measure, spending] = kind;
    const key = `${measure}${spending === "discretionary" ? ":discretionary" : ""}`;

    if (out.has(key)) {
      return;
    }

    const period = years.toReversed().find((y) => values[y] !== null && values[y] !== undefined);
    const total = filled(period) ? values[period] : undefined;

    if (!filled(period) || total === undefined || total === null) {
      return;
    }

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
      total_musd: total,
      values,
      split: "exact",
      join: null,
      archive_url: file.archiveUrl,
      rests_on: [],
      source_url: file.url,
      source_locator: [where, src.carried].filter(Boolean).join("; "),
    });
  };

  if (summary) {
    const summaryFile = summary.file ?? { url: src.fileUrl, archiveUrl: src.archiveUrl };

    for (const r of summary.rows) {
      add(
        r.measure,
        r.block,
        r.values,
        summary.years,
        summaryFile,
        [locator([r.range]), summary.unit === "billions" && BILLIONS_NOTE].filter(Boolean).join("; "),
      );
    }
  }

  if (glance?.glance && filled(src.pdfUrl)) {
    for (const r of glance.glance.rows) {
      add(
        r.label,
        null,
        r.values,
        glance.glance.periods,
        { url: src.pdfUrl, archiveUrl: src.pdfArchiveUrl },
        "page 1, At a Glance table",
      );
    }
  }

  return [...out.values()];
}

function line(
  src: Source,
  years: string[],
  l: Pick<Line, "id" | "line_kind" | "section_nums" | "section_ids" | "title" | "measure" | "split" | "rests_on"> & {
    amount: Amount;
    join?: Join | null;
    how?: string | null;
  },
): Line {
  const { amount, how, join, ...rest } = l;
  const period = must(years.at(-1), "the table's last period");

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

export function locator(ranges: string[]): string {
  const bySheet = new Map<string, string[]>();
  const other: string[] = [];

  for (const r of new Set(ranges)) {
    const groups = /^'(?<sheet>.+)'!(?<cells>.+)$/u.exec(r)?.groups;
    const sheet = groups?.sheet;
    const cells = groups?.cells;

    if (sheet !== undefined && cells !== undefined) {
      bySheet.set(sheet, [...(bySheet.get(sheet) ?? []), cells]);
    } else {
      other.push(r);
    }
  }

  const sheets = [...bySheet].map(([s, cells]) => `${s} sheet, cells ${cells.join(" and ")}`);

  return [...sheets, ...other].join("; ");
}

function kindOf(r: ParsedRow): string {
  return r.measure_kind === "other" && r.block === "revenues" && r.line_kind === "section"
    ? "revenues"
    : r.measure_kind;
}

export function baseNum(ref: string): string {
  return /^\d+[A-Z]?/u.exec(ref)?.[0] ?? ref;
}

function sum(rows: ParsedRow[], sheet: ParsedSheet, file: SourceFile): Amount {
  return {
    values: addValues(rows.map((r) => pick(r.values, sheet.years))),
    ranges: rows.map((r) => r.range),
    file,
    note: sheet.unit === "billions" ? BILLIONS_NOTE : null,
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

  for (const v of all) {
    for (const [k, x] of Object.entries(v)) {
      out[k] = x === null && (out[k] ?? null) === null ? null : round((out[k] ?? 0) + (x ?? 0));
    }
  }

  return out;
}

function scale(values: Values, f: number): Values {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === null ? null : round(v * f)]));
}

function last(values: Values, years: string[]): number | null {
  const period = years.at(-1);

  return period === undefined ? null : (values[period] ?? null);
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
