import { mkdir, readdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { TABLES } from "./tables.ts";
import type { Row, TableName } from "./tables.ts";

export * from "./index.ts";

export const ROOT = resolve(import.meta.dir, "../../..");

export const DATA = process.env.ANTIBODY_DATA ?? join(mainCheckout(), "data");

function mainCheckout(): string {
  const git = Bun.spawnSync(["git", "-C", ROOT, "rev-parse", "--path-format=absolute", "--git-common-dir"]);

  return git.success ? dirname(git.stdout.toString().trim()) : ROOT;
}

export const paths = {
  raw: (source: string) => join(DATA, source),
  table: (table: TableName) => join(DATA, "out", table),
  db: join(DATA, "antibody.duckdb"),
  bundles: join(DATA, "bundles"),
  published: join(ROOT, "apps/web/public/bundles"),
};

export async function writeRows<T extends TableName>(table: T, shard: string, rows: Row<T>[]): Promise<string> {
  const schema = TABLES[table].schema;

  const lines = rows.map((row, i) => {
    const parsed = schema.safeParse(row);

    if (!parsed.success) {
      throw new Error(`${table}/${shard} row ${i}: ${parsed.error.message}`);
    }

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

const isRow = <T extends TableName>(table: T, row: unknown): row is Row<T> =>
  TABLES[table].schema.safeParse(row).success;

export async function readRows<T extends TableName>(table: T, shard?: string): Promise<Row<T>[]> {
  const dir = paths.table(table);

  const files =
    shard !== undefined && shard !== ""
      ? [`${shard}.jsonl`]
      : (await readdir(dir).catch((): string[] => [])).filter((f) => f.endsWith(".jsonl"));

  const rows: Row<T>[] = [];

  for (const f of files) {
    const file = Bun.file(join(dir, f));

    if (!(await file.exists())) {
      continue;
    }

    for (const line of (await file.text()).split("\n")) {
      if (line) {
        const row: unknown = JSON.parse(line);

        if (!isRow(table, row)) {
          throw new Error(`${table}/${f}: a row does not match the table's schema`);
        }

        rows.push(row);
      }
    }
  }

  return rows;
}

const canCap = Bun.which("systemd-run") !== null && process.env.CI === undefined;

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

  const proc = Bun.spawn(full, {
    cwd: opts.cwd ?? ROOT,
    stdout: "pipe",
    stderr: "inherit",
    signal: opts.signal ?? new AbortController().signal,
  });

  const out = await new Response(proc.stdout).text();

  if ((await proc.exited) !== 0) {
    throw new Error(`failed (${proc.exitCode}): ${cmd.join(" ")}`);
  }

  return out;
}

export async function python(pkgDir: string, script: string, args: string[], opts?: { memoryMax?: string }) {
  const models = `FASTEMBED_CACHE_PATH=${join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "fastembed")}`;

  return await heavy(
    ["env", models, "uv", "run", "-q", "--project", pkgDir, "python", "-I", join(pkgDir, "py", script), ...args],
    opts,
  );
}
