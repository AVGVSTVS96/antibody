import type { Row, TableName } from "@antibody/core";
import { readRows, writeRows } from "@antibody/core/node";

/** Merges rows into a shard by id (new rows win), for shards several bills add to, like a session's roll calls. */
export async function upsertRows<T extends TableName>(table: T, shard: string, rows: Row<T>[]): Promise<number> {
  const merged = new Map((await readRows(table, shard)).map((r) => [r.id, r]));
  for (const r of rows) merged.set(r.id, r);
  await writeRows(table, shard, [...merged.values()]);
  return merged.size;
}
