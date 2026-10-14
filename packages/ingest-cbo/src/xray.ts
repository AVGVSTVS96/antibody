import { resolve } from "node:path";
import type { BillId, Row, StageContext } from "@antibody/core";
import { python, readRows, writeRows } from "@antibody/core/node";
import { baselineOf, type Listing, parseListings, versionCode } from "./estimates.ts";
import { billstatus, type Fetched, publicationFiles } from "./fetch.ts";
import { buildLines } from "./lines.ts";
import type { Glance, Parsed } from "./parsed.ts";
import { sectionMap } from "./sections.ts";

const PKG = resolve(import.meta.dir, "..");

export async function parse<T>(command: "xlsx" | "pdf" | "table1" | "glance", file: string): Promise<T | null> {
  try {
    return JSON.parse(await python(PKG, "cbo.py", [command, file])) as T;
  } catch {
    return null;
  }
}

export const estimateId = (bill: BillId, l: Listing) => `${bill}.cbo-${l.pubId}`;

interface Read {
  main: (Parsed & { from: Fetched }) | null;
  pdf: Fetched | null;
  glance: Glance | null;
}

/**
 * Picks the richest table a publication has: per-title Excel (one file or one per committee, merged), then
 * per-section PDF tables, then a small bill's table1.xlsx. The PDF is read for its At a Glance box, mandate
 * answers and baseline wording either way.
 */
async function read(files: Fetched[], bill: BillId): Promise<Read> {
  const token = bill.split("-").slice(1).join("");
  const pdfs = files.filter((f) => /\.pdf$/i.test(f.url));
  const pdf = pdfs.find((f) => f.url.toLowerCase().replace(/[-_]/g, "").includes(token)) ?? pdfs[0] ?? null;
  const glance = pdf ? await parse<Glance>("glance", pdf.file) : null;
  const tagged = (p: Parsed, f: Fetched): Parsed => {
    const file = { url: f.url, archiveUrl: f.archiveUrl };
    return {
      ...p,
      sheets: p.sheets.map((s) => ({ ...s, file })),
      summary: p.summary ? { ...p.summary, file } : null,
    };
  };
  const sheets = files.filter((f) => /\.xlsx?$/i.test(f.url));
  const workbooks: { p: Parsed; f: Fetched }[] = [];
  for (const f of sheets.filter((f) => !/table1/i.test(f.url))) {
    const p = await parse<Parsed>("xlsx", f.file);
    if (p && (p.sheets.length || p.summary?.rows.length)) workbooks.push({ p: tagged(p, f), f });
  }
  if (workbooks.some((w) => w.p.sheets.length)) {
    const lead = workbooks.find((w) => w.p.summary?.rows.length) ?? workbooks[0]!;
    const main = { format: "xlsx" as const, sheets: workbooks.flatMap((w) => w.p.sheets), summary: lead.p.summary };
    return { main: { ...main, from: lead.f }, pdf, glance };
  }
  const tables = pdf ? await parse<Parsed>("pdf", pdf.file) : null;
  if (pdf && tables?.sheets.some((s) => s.rows.some((r) => r.line_kind === "section")))
    return { main: { ...tagged(tables, pdf), from: pdf }, pdf, glance };
  for (const f of sheets.filter((f) => /table1/i.test(f.url))) {
    const p = await parse<Parsed>("table1", f.file);
    if (p?.summary?.rows.length) return { main: { ...tagged(p, f), from: f }, pdf, glance };
  }
  if (pdf && tables?.summary?.rows.length)
    return { main: { ...tagged({ ...tables, sheets: [] }, pdf), from: pdf }, pdf, glance };
  return { main: null, pdf, glance };
}

export async function xray(ctx: StageContext) {
  const bill = ctx.bill!;
  const opts = { refresh: ctx.refresh, signal: ctx.signal };
  const listings = parseListings(await billstatus(bill, opts));
  const [sections, versions] = await Promise.all([readRows("sections", bill), readRows("versions", bill)]);
  const known = versions.map((v) => v.code);
  ctx.log(`${listings.length} CBO estimates listed in BILLSTATUS; ${sections.length} sections to map onto`);

  const estimates: Row<"cbo_estimates">[] = [];
  const lines: Row<"cbo_lines">[] = [];
  for (const l of listings) {
    const id = estimateId(bill, l);
    const files = await publicationFiles(l, bill, opts);
    const { main, pdf, glance } = await read(files, bill);
    const code = versionCode(l.description, bill, known);
    const { baseline, label } = baselineOf(
      l,
      glance ? { month: glance.baseline_month, enforcement: glance.budget_enforcement_baseline } : null,
    );
    const source = main?.from ?? pdf;
    const built = buildLines(
      {
        estimateId: id,
        billId: bill,
        fileUrl: source?.url ?? l.url,
        archiveUrl: source?.archiveUrl ?? null,
        pdfUrl: pdf?.url ?? null,
        pdfArchiveUrl: pdf?.archiveUrl ?? null,
      },
      main,
      glance,
      sectionMap(sections, code),
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
      version_scored: l.description || l.title,
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
