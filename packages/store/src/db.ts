import { readdir } from "node:fs/promises";
import { columns, ddl, selectList, TABLE_NAMES } from "@antibody/core";
import type { TableName } from "@antibody/core";
import { paths } from "@antibody/core/node";
import { DuckDBInstance, INTEGER, LIST, listValue, VARCHAR } from "@duckdb/node-api";
import type { DuckDBType, DuckDBValue } from "@duckdb/node-api";

export async function openDb(file = paths.db, { memoryLimit = "3GB" } = {}) {
  const instance = await DuckDBInstance.create(file);
  const db = await instance.connect();
  await db.run(`SET memory_limit = '${memoryLimit}'`);

  return db;
}

export type Db = Awaited<ReturnType<typeof openDb>>;

export async function loadTables(
  db: Db,
  outDir = (t: TableName) => paths.table(t),
  report = (table: TableName, problem: string) => {
    console.warn(`! ${table}: ${problem}`);
  },
) {
  const counts: Partial<Record<TableName, number>> = {};

  for (const table of TABLE_NAMES) {
    await db.run(`DROP TABLE IF EXISTS ${table}`);
    await db.run(ddl(table));
    const dir = outDir(table);
    const files = (await readdir(dir).catch((): string[] => [])).filter((f) => f.endsWith(".jsonl"));

    if (files.length > 0) {
      const cols = columns(table)
        .map(([n, t]) => `"${n}": '${t.replace(" NOT NULL", "")}'`)
        .join(", ");

      const glob = `${dir}/*.jsonl`.replaceAll("'", "''");
      const source = `read_json('${glob}', format = 'newline_delimited', columns = {${cols}})`;

      try {
        await db.run(`INSERT OR IGNORE INTO ${table} SELECT ${selectList(table)} FROM ${source}`);
        const dupes = await query(db, `SELECT id FROM ${source} GROUP BY id HAVING count(*) > 1 ORDER BY id`);
        const ids = dupes.map((r) => r.id).filter(isText);

        if (ids.length > 0) {
          report(table, `${ids.length} duplicate ids skipped, e.g. ${ids.slice(0, 3).join(", ")}`);
        }
      } catch (error) {
        await db.run(`DELETE FROM ${table}`);
        report(table, `not loaded: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}`);
      }
    }

    counts[table] = await countOf(db, `SELECT count(*)::INTEGER AS n FROM ${table}`);
  }

  return counts;
}

export type Plain = string | number | boolean | null | Plain[] | { [k: string]: Plain };

export type PlainRow = Record<string, Plain>;

export type Param = string | number | boolean | null | string[] | number[];

export const isText = <T>(v: T): v is T & string => typeof v === "string";

export const isNumber = <T>(v: T): v is T & number => typeof v === "number";

const isNumbers = (v: string[] | number[]): v is number[] => typeof v[0] === "number";

export const isPlain = (v: unknown): v is Plain =>
  v === null ||
  typeof v === "string" ||
  typeof v === "number" ||
  typeof v === "boolean" ||
  (Array.isArray(v) ? v.every(isPlain) : typeof v === "object" && Object.values(v).every(isPlain));

export async function query(db: Db, sql: string, params: Record<string, Param> = {}): Promise<PlainRow[]> {
  const values: Record<string, DuckDBValue> = {};
  const types: Record<string, DuckDBType> = {};

  for (const [k, v] of Object.entries(params)) {
    if (!Array.isArray(v)) {
      values[k] = v;
      continue;
    }

    values[k] = listValue(v);
    types[k] = LIST(isNumbers(v) ? INTEGER : VARCHAR);
  }

  const reader = await db.runAndReadAll(sql, values, types);

  const fixes = reader.columnNames().map((name, i) => {
    const t = reader.columnType(i);
    const type = t.alias ?? t.toString();

    if (/^(?:BIGINT|HUGEINT|UBIGINT)$/u.test(type)) {
      return [name, (v: Plain) => (v === null ? v : Number(v))] as const;
    }

    if (type === "JSON") {
      return [name, json] as const;
    }

    if ("valueType" in t && t.valueType.alias === "JSON") {
      return [name, (v: Plain) => (Array.isArray(v) ? v.map(json) : v)] as const;
    }

    if (type.startsWith("TIMESTAMP")) {
      return [name, (v: Plain) => (isText(v) ? toIso(v) : v)] as const;
    }

    return null;
  });

  const rows: PlainRow[] = reader.getRowObjectsJson();

  for (const fix of fixes) {
    if (fix) {
      const [name, apply] = fix;

      for (const r of rows) {
        const v = r[name];

        if (v !== undefined) {
          r[name] = apply(v);
        }
      }
    }
  }

  return rows;
}

export async function countOf(db: Db, sql: string, params: Record<string, Param> = {}): Promise<number> {
  const [row] = await query(db, sql, params);
  const n = row?.n;

  if (!isNumber(n)) {
    throw new Error(`no count from ${sql}`);
  }

  return n;
}

function json(v: Plain): Plain {
  if (!isText(v)) {
    return v;
  }

  const parsed: unknown = JSON.parse(v);

  if (!isPlain(parsed)) {
    throw new Error("a JSON column held a value JSON.parse cannot return");
  }

  return parsed;
}

const toIso = (v: string) => new Date(v.replace(" ", "T").replace(/([+-]\d\d)$/u, "$1:00")).toISOString();

export async function tableNames(db: Db): Promise<Set<string>> {
  return new Set((await query(db, "SELECT table_name AS t FROM duckdb_tables()")).map((r) => r.t).filter(isText));
}
