import { billDisplay } from "@antibody/core";
import type { BillId, Row, StageContext } from "@antibody/core";
import { readRows, writeRows } from "@antibody/core/node";
import { baselineOf, companions, parseListings, versionCode } from "./estimates.ts";
import type { Listing } from "./estimates.ts";
import { billstatus, publicationFiles } from "./fetch.ts";
import type { Fetched } from "./fetch.ts";
import { baseNum, buildLines } from "./lines.ts";
import { readGlance, readTables } from "./parsed.ts";
import type { Glance, Parsed } from "./parsed.ts";
import { scopeRows } from "./scope.ts";
import { closestVersion, sectionIndex } from "./sections.ts";
import type { Labelled } from "./sections.ts";

const ITEMS = new Set(["section", "title", "program"]);

export async function orNull<T>(pending: Promise<T>): Promise<T | null> {
  try {
    return await pending;
  } catch {
    return null;
  }
}

function labelled(main: Parsed | null): Labelled[] {
  return (main?.sheets ?? []).flatMap((s) =>
    s.rows.flatMap((r) => {
      const [num] = r.sections;

      return r.line_kind === "section" && r.sections.length === 1 && num !== undefined
        ? [{ num: baseNum(num), title: r.section_title, division: r.division ?? null }]
        : [];
    }),
  );
}

export const estimateId = (bill: BillId, l: Listing) => `${bill}.cbo-${l.pubId}`;

interface Read {
  main: (Parsed & { from: Fetched }) | null;
  pdf: Fetched | null;
  glance: Glance | null;
}

const tagged = (p: Parsed, f: Fetched): Parsed => {
  const file = { url: f.url, archiveUrl: f.archiveUrl };

  return {
    ...p,
    sheets: p.sheets.map((s) => ({ ...s, file })),
    summary: p.summary ? { ...p.summary, file } : null,
  };
};

const hasSummaryRows = (p: Parsed | null) => (p?.summary?.rows.length ?? 0) > 0;

async function read(files: Fetched[], bill: BillId): Promise<Read> {
  const token = bill.split("-").slice(1).join("");
  const pdfs = files.filter((f) => /\.pdf$/iu.test(f.url));
  const pdf = pdfs.find((f) => f.url.toLowerCase().replaceAll(/[-_]/gu, "").includes(token)) ?? pdfs[0] ?? null;
  const glance = pdf ? await orNull(readGlance(pdf.file)) : null;
  const sheets = files.filter((f) => /\.xlsx?$/iu.test(f.url));
  const workbooks: { p: Parsed; f: Fetched }[] = [];

  for (const f of sheets.filter((x) => !/table1/iu.test(x.url))) {
    const p = await orNull(readTables("xlsx", f.file));

    if (p && (p.sheets.length > 0 || hasSummaryRows(p))) {
      workbooks.push({ p: tagged(p, f), f });
    }
  }

  const lead = workbooks.find((w) => hasSummaryRows(w.p)) ?? workbooks[0];

  if (lead && workbooks.some((w) => w.p.sheets.length)) {
    const main = { format: "xlsx" as const, sheets: workbooks.flatMap((w) => w.p.sheets), summary: lead.p.summary };

    return { main: { ...main, from: lead.f }, pdf, glance };
  }

  const tables = pdf ? await orNull(readTables("pdf", pdf.file)) : null;

  if (pdf && tables?.sheets.some((s) => s.rows.some((r) => ITEMS.has(r.line_kind))) === true) {
    return { main: { ...tagged(tables, pdf), from: pdf }, pdf, glance };
  }

  for (const f of sheets.filter((x) => /table1/iu.test(x.url))) {
    const p = await orNull(readTables("table1", f.file));

    if (p && hasSummaryRows(p)) {
      return { main: { ...tagged(p, f), from: f }, pdf, glance };
    }
  }

  if (pdf && tables && hasSummaryRows(tables)) {
    return { main: { ...tagged({ ...tables, sheets: [] }, pdf), from: pdf }, pdf, glance };
  }

  return { main: null, pdf, glance };
}

export async function xray(ctx: StageContext) {
  const bill = ctx.bill;

  if (bill === null) {
    throw new Error("the cbo stage runs for one bill");
  }

  const opts = { refresh: ctx.refresh, signal: ctx.signal };
  const status = await billstatus(bill, opts);
  const listings = parseListings(status);

  if (!listings.length) {
    for (const other of companions(status, bill)) {
      const theirs = await billstatus(other, opts).catch(() => null);
      const seen = new Set(listings.map((l) => l.pubId));

      for (const l of theirs === null ? [] : parseListings(theirs)) {
        if (!seen.has(l.pubId)) {
          listings.push({ ...l, via: other });
        }
      }
    }
  }

  const [sections, versions] = await Promise.all([readRows("sections", bill), readRows("versions", bill)]);
  const known = versions.map((v) => v.code);
  const borrowed = [...new Set(listings.flatMap((l) => l.via ?? []))];
  ctx.log(
    `${listings.length} CBO estimates listed in BILLSTATUS${borrowed.length ? ` of ${borrowed.map(billDisplay).join(", ")}, which carried the same text` : ""}; ${sections.length} sections to map onto`,
  );

  const estimates: Row<"cbo_estimates">[] = [];
  const lines: Row<"cbo_lines">[] = [];

  for (const l of listings) {
    const id = estimateId(bill, l);
    const scored = l.via ?? bill;
    const files = await publicationFiles(l, scored, opts);
    const { main, pdf, glance } = await read(files, scored);

    if (main && glance) {
      scopeRows(main.sheets, glance.pages);
    }

    const code = l.via === undefined ? versionCode(l.description, bill, known) : null;

    const { baseline, label } = baselineOf(
      l,
      glance ? { month: glance.baseline_month, enforcement: glance.budget_enforcement_baseline } : null,
    );

    const source = main?.from ?? pdf;

    const close =
      code === null
        ? closestVersion(
            sections,
            (main?.sheets ?? []).flatMap((s) => s.rows.flatMap((r) => r.sections.map(baseNum))),
            known,
          )
        : null;

    const index = sectionIndex(sections, code ?? close?.code ?? null, labelled(main));

    const built = buildLines(
      {
        estimateId: id,
        billId: bill,
        fileUrl: source?.url ?? l.url,
        archiveUrl: source?.archiveUrl ?? null,
        pdfUrl: pdf?.url ?? null,
        pdfArchiveUrl: pdf?.archiveUrl ?? null,
        numbering:
          close === null
            ? null
            : `CBO scored text GovInfo does not publish (${l.description}); its section numbers are joined to the ${close.code} text, which numbers ${close.covered} of them the same way`,
        carried:
          l.via === undefined
            ? null
            : `CBO's estimate is of ${billDisplay(l.via)}, which BILLSTATUS relates to this bill as carrying the same text`,
      },
      main,
      glance,
      index.join,
      index.places,
    );

    lines.push(...built.lines);
    estimates.push({
      id,
      bill_id: bill,
      url: l.url,
      file_url: source?.url ?? l.url,
      archive_url: source?.archiveUrl ?? null,
      published_on: l.pubDate.slice(0, 10) || null,
      version_code: code,
      version_scored:
        l.via === undefined ? l.description || l.title : `${billDisplay(l.via)}: ${l.description || l.title}`,
      baseline,
      baseline_label: label,
      per_section: built.lines.some((x) => x.line_kind === "section"),
      mandate_private: glance?.mandates.private_sector ?? null,
      mandate_intergovernmental: glance?.mandates.intergovernmental ?? null,
      pdf_url: pdf?.url ?? null,
      pdf_archive_url: pdf?.archiveUrl ?? null,
      source_url: l.url,
      source_locator: null,
    });
    const r = built.reconcile;
    ctx.log(
      [
        `${l.pubId} ${code ?? "?"} ${baseline}: ${files.length} files, ${main?.format ?? "no table"}`,
        `${built.lines.length} lines`,
        r.checks ? `reconcile ${r.exact}/${r.checks} exact` : null,
        r.failing.length ? `NOT reconciled: ${r.failing.join(", ")}` : null,
        sections.length && built.unmapped.length
          ? `${built.unmapped.length} CBO section numbers not found in ${code ?? "an unknown version"}: ${built.unmapped.slice(0, 8).join(" ")}`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
    );
  }

  await writeRows("cbo_estimates", bill, estimates);
  await writeRows("cbo_lines", bill, lines);
}
