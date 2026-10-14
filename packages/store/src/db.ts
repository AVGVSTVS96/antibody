import { readdir } from "node:fs/promises";
import { columns, ddl, TABLE_NAMES, type TableName } from "@antibody/core";
import { paths } from "@antibody/core/node";
import { DuckDBInstance, type DuckDBType, type DuckDBValue, INTEGER, LIST, listValue, VARCHAR } from "@duckdb/node-api";

export async function openDb(file = paths.db, { memoryLimit = "3GB" } = {}) {
  const instance = await DuckDBInstance.create(file);
  const db = await instance.connect();
  await db.run(`SET memory_limit = '${memoryLimit}'`);
  return db;
}
export type Db = Awaited<ReturnType<typeof openDb>>;

/**
 * Recreates every contract table from data/out/<table>/*.jsonl. Returns row counts. One bad shard shouldn't stop
 * every bundle: a row whose id repeats is skipped, a table whose rows break its constraints stays empty, and both
 * are reported through `report`.
 */
export async function loadTables(
  db: Db,
  outDir = (t: TableName) => paths.table(t),
  report = (table: TableName, problem: string) => console.warn(`! ${table}: ${problem}`),
) {
  const counts: Partial<Record<TableName, number>> = {};
  for (const table of TABLE_NAMES) {
    await db.run(`DROP TABLE IF EXISTS ${table}`);
    await db.run(ddl(table));
    const dir = outDir(table);
    const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".jsonl"));
    if (files.length) {
      const cols = columns(table)
        .map(([n, t]) => `"${n}": '${t.replace(" NOT NULL", "")}'`)
        .join(", ");
      const glob = `${dir}/*.jsonl`.replaceAll("'", "''");
      const source = `read_json('${glob}', format = 'newline_delimited', columns = {${cols}})`;
      try {
        await db.run(`INSERT OR IGNORE INTO ${table} SELECT * FROM ${source}`);
        const dupes = await db.runAndReadAll(`SELECT id FROM ${source} GROUP BY id HAVING count(*) > 1 ORDER BY id`);
        const ids = dupes.getRows().map((r) => String(r[0]));
        if (ids.length) report(table, `${ids.length} duplicate ids skipped, e.g. ${ids.slice(0, 3).join(", ")}`);
      } catch (e) {
        await db.run(`DELETE FROM ${table}`);
        report(table, `not loaded: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    const reader = await db.runAndReadAll(`SELECT count(*)::INTEGER FROM ${table}`);
    counts[table] = reader.getRows()[0]![0] as number;
  }
  return counts;
}

type Plain = string | number | boolean | null | Plain[] | { [k: string]: Plain };

export type Param = string | number | boolean | null | string[] | number[];

/**
 * Runs a query with `$name` params (arrays bind as typed lists) and returns plain rows shaped like the contract's
 * JSONL: DATE as `YYYY-MM-DD`, TIMESTAMPTZ as ISO, BIGINT as number, JSON columns parsed.
 */
export async function query<T = Record<string, Plain>>(
  db: Db,
  sql: string,
  params: Record<string, Param> = {},
): Promise<T[]> {
  const values: Record<string, DuckDBValue> = {};
  const types: Record<string, DuckDBType> = {};
  for (const [k, v] of Object.entries(params)) {
    if (!Array.isArray(v)) {
      values[k] = v;
      continue;
    }
    values[k] = listValue(v);
    types[k] = LIST(typeof v[0] === "number" ? INTEGER : VARCHAR);
  }
  const reader = await db.runAndReadAll(sql, values, types);
  const fix = reader.columnNames().map((name, i) => {
    const t = reader.columnType(i);
    const type = t.alias ?? t.toString();
    if (/^(BIGINT|HUGEINT|UBIGINT)$/.test(type)) return [name, (v: Plain) => (v == null ? v : Number(v))] as const;
    if (type === "JSON") return [name, json] as const;
    if ("valueType" in t && t.valueType.alias === "JSON")
      return [name, (v: Plain) => (Array.isArray(v) ? v.map(json) : v)] as const;
    if (type.startsWith("TIMESTAMP")) return [name, (v: Plain) => (v == null ? v : toIso(v as string))] as const;
    return null;
  });
  const rows = reader.getRowObjectsJson() as Record<string, Plain>[];
  for (const f of fix) if (f) for (const r of rows) r[f[0]] = f[1](r[f[0]]!);
  return rows as T[];
}

const json = (v: Plain): Plain => (typeof v === "string" ? JSON.parse(v) : v);
const toIso = (v: string) => new Date(v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")).toISOString();

/** Tables present in this database (so the builder keeps working while a part's new table hasn't landed). */
export async function tableNames(db: Db): Promise<Set<string>> {
  return new Set((await query<{ t: string }>(db, "SELECT table_name AS t FROM duckdb_tables()")).map((r) => r.t));
}
