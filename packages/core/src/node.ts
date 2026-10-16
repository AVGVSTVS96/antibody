import { mkdir, readdir, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { type Row, TABLES, type TableName } from "./tables.ts";

export * from "./index.ts";

export const ROOT = resolve(import.meta.dir, "../../..");

/**
 * Shared data lives in the main checkout's `data/` (gitignored), so every worktree reads the same downloads.
 * Override with ANTIBODY_DATA.
 */
export const DATA = process.env.ANTIBODY_DATA ?? join(mainCheckout(), "data");

function mainCheckout(): string {
  const git = Bun.spawnSync(["git", "-C", ROOT, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return git.success ? dirname(git.stdout.toString().trim()) : ROOT;
}

export const paths = {
  /** Raw downloads for one source: data/<source>/ (bills, cbo, lobbying, trades, entities, attention, news, fec …). */
  raw: (source: string) => join(DATA, source),
  /** Contract rows: data/out/<table>/<shard>.jsonl */
  table: (table: TableName) => join(DATA, "out", table),
  db: join(DATA, "antibody.duckdb"),
  bundles: join(DATA, "bundles"),
  published: join(ROOT, "apps/web/public/bundles"),
};

/**
 * Validates every row against the table's schema and replaces `data/out/<table>/<shard>.jsonl` atomically.
 * Shard by bill id for per-bill tables (`119-s-1582`), by year or source for global ones.
 */
export async function writeRows<T extends TableName>(table: T, shard: string, rows: Row<T>[]): Promise<string> {
  const schema = TABLES[table].schema;
  const lines = rows.map((row, i) => {
    const parsed = schema.safeParse(row);
    if (!parsed.success) throw new Error(`${table}/${shard} row ${i}: ${parsed.error.message}`);
    return JSON.stringify(parsed.data);
  });
  const dir = paths.table(table);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${shard}.jsonl`);
  const tmp = `${file}.${process.pid}.tmp`;
  await Bun.write(tmp, lines.length ? `${lines.join("\n")}\n` : "");
  await rename(tmp, file);
  return file;
}

/** Reads one shard, or every shard of the table, without DuckDB. */
export async function readRows<T extends TableName>(table: T, shard?: string): Promise<Row<T>[]> {
  const dir = paths.table(table);
  const files = shard
    ? [`${shard}.jsonl`]
    : (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".jsonl"));
  const rows: Row<T>[] = [];
  for (const f of files) {
    const file = Bun.file(join(dir, f));
    if (!(await file.exists())) continue;
    for (const line of (await file.text()).split("\n")) if (line) rows.push(JSON.parse(line));
  }
  return rows;
}

const canCap = Bun.which("systemd-run") !== null && process.env.CI === undefined;

/**
 * Runs a command, memory-capped with `systemd-run --user --scope -p MemoryMax=<cap>` on the server
 * (plain elsewhere, like CI). Use it for bulk downloads, OCR/vision batches, big parses and DuckDB loads.
 */
export async function heavy(
  cmd: string[],
  opts: { memoryMax?: string; cwd?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const full = canCap
    ? [
        "systemd-run",
        "--user",
        "--scope",
        "-q",
        "-p",
        `MemoryMax=${opts.memoryMax ?? "4G"}`,
        "-p",
        "CPUWeight=20",
        ...cmd,
      ]
    : cmd;
  const proc = Bun.spawn(full, { cwd: opts.cwd ?? ROOT, stdout: "pipe", stderr: "inherit", signal: opts.signal });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error(`failed (${proc.exitCode}): ${cmd.join(" ")}`);
  return out;
}

/**
 * Runs a Python script that lives in a package's `py/` folder, with that package's uv project, in isolated mode
 * (`-I`, so a downloaded file named like a module is never imported). Capped like `heavy`.
 */
export function python(pkgDir: string, script: string, args: string[], opts?: { memoryMax?: string }) {
  return heavy(["uv", "run", "-q", "--project", pkgDir, "python", "-I", join(pkgDir, "py", script), ...args], opts);
}
