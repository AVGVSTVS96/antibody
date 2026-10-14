import { readdir } from "node:fs/promises";
import { columns, ddl, TABLE_NAMES, type TableName } from "@antibody/core";
import { paths } from "@antibody/core/node";
import { DuckDBInstance } from "@duckdb/node-api";

export async function openDb(file = paths.db) {
  const instance = await DuckDBInstance.create(file);
  return instance.connect();
}
export type Db = Awaited<ReturnType<typeof openDb>>;

/** Recreates every contract table from data/out/<table>/*.jsonl. Returns row counts. */
export async function loadTables(db: Db, outDir = (t: TableName) => paths.table(t)) {
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
      await db.run(
        `INSERT INTO ${table} SELECT * FROM read_json('${glob}', format = 'newline_delimited', columns = {${cols}})`,
      );
    }
    const reader = await db.runAndReadAll(`SELECT count(*)::INTEGER FROM ${table}`);
    counts[table] = reader.getRows()[0]![0] as number;
  }
  return counts;
}
