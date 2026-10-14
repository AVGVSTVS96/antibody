import { mkdirSync } from "node:fs";
import { exists, mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { heavy, paths } from "@antibody/core/node";
import { z } from "zod";
import { pool } from "./http.ts";

const emptyDir = join(homedir(), ".cache", "claude-empty");
mkdirSync(emptyDir, { recursive: true });

export const VISION_MODEL = process.env.ANTIBODY_VISION_MODEL ?? "claude-sonnet-5-5";
const PKG = join(import.meta.dir, "..");
const LONG_EDGE = 1650;

export const FIELDS = ["owner", "asset", "ticker", "type", "date", "notified", "amount"] as const;
const Field = z.enum(FIELDS);

const VisionRow = z.object({
  owner: z.string(),
  asset: z.string(),
  ticker: z.string().nullable(),
  type: z.string(),
  date: z.string(),
  notified: z.string().nullable(),
  amount: z.string(),
  /** Models sometimes explain ("date: last digit smudged"); keep the field name, drop the rest. */
  uncertain: z
    .array(z.string())
    .transform((xs) => [...new Set(xs.flatMap((x) => FIELDS.filter((f) => x.trim().toLowerCase().startsWith(f))))]),
  note: z.string().nullable().optional(),
});
export type VisionRow = z.infer<typeof VisionRow>;

const PageRead = z.object({
  /** Degrees the page's text is turned clockwise from upright. Scanned forms often sit sideways. */
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).catch(0),
  page_kind: z.enum(["form", "statement", "cover", "other"]),
  filer_name: z.string().nullable(),
  rows: z.array(VisionRow),
});
export type PageRead = z.infer<typeof PageRead>;

const Recheck = z.object({
  cells: z.array(z.object({ row: z.number().int(), field: Field, value: z.string(), readable: z.boolean() })),
});
export type Recheck = z.infer<typeof Recheck>;

export interface Call {
  costUsd: number;
  ms: number;
  inputTokens: number;
  outputTokens: number;
}

/** One page's vision result, cached at data/trades/vision/reads/<doc>/<page>.json. */
export interface PageResult {
  doc: string;
  page: number;
  model: string;
  /** Set when the page image was turned upright before this read. */
  rotated?: number | null;
  read: PageRead;
  recheck: Recheck | null;
  calls: Call[];
}

const READ_PROMPT = `You transcribe one scanned page of a US congressional Periodic Transaction Report (a member of Congress disclosing stock and other securities trades). The page may be a House or Senate paper form (a grid where the transaction type and the amount range are marked with an X in a column), a handwritten or typed list, or an attached brokerage statement. It may be rotated.

Transcribe every transaction row on the page, top to bottom, exactly as written:
- owner: the owner code as marked ("SP", "JT", "DC", or words like "Spouse", "Joint", "Self", "Dependent child"); "" when the owner column is blank (that means the filer).
- asset: the full asset name as written, including share class, maturity or option details.
- ticker: a ticker symbol only if one is written on the page; otherwise null. Never infer one.
- type: "purchase", "sale", "sale_partial" (a partial sale, if the form says partial) or "exchange", from the marked column or the words written; "" if no mark is visible.
- date: the transaction date exactly as written (e.g. "10/20/23"). notified: the notification date as written, or null if the form has no such column or it is blank.
- amount: the range whose column carries the mark, written like "$1,001 - $15,000" or "Over $50,000,000"; or the exact dollar amount when one is written instead.
- uncertain: every field whose value you could not read with certainty (smudged, cut off, ambiguous mark, overlapping X). Never guess silently: when you are unsure of a character, write your best reading with "_" in place of unreadable characters and list the field here.
- note: anything on the row that matters (e.g. "crossed out", "amended", a footnote), else null.

Skip the form's printed example rows (like "IBM Corp." or "(DC) Microsoft") and blank rows. A row that only says "see attachment" is not a transaction. On a brokerage statement, a transaction is a buy, sell or exchange of a security; skip dividends, interest, fees, sweeps and transfers.

rotation: how far the page's text is turned clockwise from upright: 0 when it reads left to right along the top, 90 when text lines run top to bottom (the top of the page is on the right), 180 when upside down, 270 when lines run bottom to top. Form pages are often scanned sideways; read the rows in their real order and keep every mark in the column it sits under.

page_kind: "form" for a transaction form page, "statement" for an attached brokerage or account statement, "cover" for a cover letter or signature page with no rows, "other" otherwise. filer_name: the filer's name if it is printed or written on this page, else null.

Answer with one JSON object and nothing else: {"rotation": ..., "page_kind": ..., "filer_name": ..., "rows": [{"owner", "asset", "ticker", "type", "date", "notified", "amount", "uncertain", "note"}]}`;

const RECHECK_PROMPT = `You are checking specific cells of a transcription of this scanned congressional Periodic Transaction Report page. Look at the image fresh for each listed cell (the first reading is given only so you can find the row; do not assume it is right). For each cell, give the value exactly as written on the page, and readable: false if the page itself does not let anyone read it with certainty. Use "_" for characters that cannot be read.

Answer with one JSON object and nothing else: {"cells": [{"row", "field", "value", "readable"}]}`;

export const visionRoot = () => process.env.ANTIBODY_VISION_DIR ?? join(paths.raw("trades"), "vision");
const readPath = (doc: string, page: number) => join(visionRoot(), "reads", doc, `${page}.json`);
const imagePath = (doc: string, page: number) => join(visionRoot(), "img", doc, `${page}.png`);

export async function cachedRead(doc: string, page: number): Promise<PageResult | null> {
  const f = Bun.file(readPath(doc, page));
  return (await f.exists()) ? ((await f.json()) as PageResult) : null;
}

export async function cachedPages(doc: string): Promise<number[]> {
  const files = await readdir(join(visionRoot(), "reads", doc)).catch(() => [] as string[]);
  return files.filter((f) => f.endsWith(".json")).map((f) => Number(f.slice(0, -5)));
}

/** Renders a scanned PDF (all pages) or one page image into grayscale PNGs, long edge 1650 px. */
export async function prepare(doc: string, src: string, page?: number) {
  const dir = join(visionRoot(), "img", doc);
  await mkdir(dir, { recursive: true });
  if (page !== undefined && (await exists(imagePath(doc, page)))) return;
  if (page === undefined && (await readdir(dir)).length) return;
  const args = [src, dir, String(LONG_EDGE), ...(page === undefined ? [] : [String(page)])];
  await heavy(["uv", "run", "-q", "--project", PKG, "python", "-I", join(PKG, "py/prep_image.py"), ...args]);
}

async function ask(image: string, system: string, text: string): Promise<{ answer: unknown; call: Call }> {
  const data = Buffer.from(await Bun.file(image).arrayBuffer()).toString("base64");
  const message = {
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data } },
        { type: "text", text },
      ],
    },
  };
  const proc = Bun.spawn(
    [
      "claude",
      "-p",
      "--model",
      VISION_MODEL,
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--tools",
      "",
      "--safe-mode",
      "--strict-mcp-config",
      "--no-session-persistence",
      "--system-prompt",
      system,
    ],
    { cwd: emptyDir, stdin: new Blob([`${JSON.stringify(message)}\n`]), stdout: "pipe", stderr: "pipe" },
  );
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  const result = out
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .find((m) => m.type === "result");
  if (!result || result.is_error)
    throw new Error(`claude -p failed: ${result?.result ?? (await new Response(proc.stderr).text())}`);
  const json = String(result.result).match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error(`no JSON in answer: ${String(result.result).slice(0, 200)}`);
  return {
    answer: JSON.parse(json),
    call: {
      costUsd: result.total_cost_usd ?? 0,
      ms: result.duration_ms ?? 0,
      inputTokens:
        (result.usage?.input_tokens ?? 0) +
        (result.usage?.cache_creation_input_tokens ?? 0) +
        (result.usage?.cache_read_input_tokens ?? 0),
      outputTokens: result.usage?.output_tokens ?? 0,
    },
  };
}

async function retry<T>(fn: () => Promise<T>, tries = 2): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries) throw e;
    }
  }
}

/** Reads one page image, turned upright first when the model says it was scanned sideways; uncertain cells get a second read. */
export async function readPage(doc: string, page: number): Promise<PageResult> {
  let image = imagePath(doc, page);
  const calls: Call[] = [];
  const transcribe = () =>
    retry(async () => {
      const { answer, call } = await ask(image, READ_PROMPT, "Transcribe this page.");
      calls.push(call);
      return PageRead.parse(answer);
    });
  let read = await transcribe();
  let rotated: number | null = null;
  if (read.rotation) {
    rotated = read.rotation;
    const upright = image.replace(/\.png$/, `.r${rotated}.png`);
    await heavy([
      "uv",
      "run",
      "-q",
      "--project",
      PKG,
      "python",
      "-I",
      join(PKG, "py/rotate_image.py"),
      image,
      upright,
      String(rotated),
    ]);
    image = upright;
    read = await transcribe();
  }
  const cells = read.rows.flatMap((r, row) => r.uncertain.map((field) => ({ row, field, firstReading: r[field] })));
  let recheck: Recheck | null = null;
  if (cells.length) {
    const rows = read.rows.map((r, row) => ({ row, asset: r.asset, date: r.date }));
    recheck = await retry(async () => {
      const { answer, call } = await ask(
        image,
        RECHECK_PROMPT,
        `Rows on this page (for locating): ${JSON.stringify(rows)}\nCells to check: ${JSON.stringify(cells)}`,
      );
      calls.push(call);
      return Recheck.parse(answer);
    });
  }
  const result: PageResult = { doc, page, model: VISION_MODEL, rotated, read, recheck, calls };
  await mkdir(join(visionRoot(), "reads", doc), { recursive: true });
  await Bun.write(readPath(doc, page), JSON.stringify(result, null, 1));
  return result;
}

export interface VisionJob {
  doc: string;
  page: number;
}

/** Reads the given pages, `workers` at a time, skipping cached ones. Returns per-page results and failures. */
export async function readPages(jobs: VisionJob[], workers: number, log: (m: string) => void) {
  const done: PageResult[] = [];
  const failed: { job: VisionJob; error: string }[] = [];
  const t0 = performance.now();
  await pool(jobs, workers, async (job) => {
    if (await cachedRead(job.doc, job.page)) return;
    try {
      done.push(await readPage(job.doc, job.page));
    } catch (e) {
      failed.push({ job, error: String(e).slice(0, 300) });
    }
    if ((done.length + failed.length) % 10 === 0)
      log(
        `  vision ${done.length + failed.length}/${jobs.length}, $${done
          .flatMap((d) => d.calls)
          .reduce((s, c) => s + c.costUsd, 0)
          .toFixed(2)}, ${((performance.now() - t0) / 1000).toFixed(0)}s`,
      );
  });
  return { done, failed };
}
