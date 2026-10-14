import { mkdir, rmdir } from "node:fs/promises";
import { join } from "node:path";
import type { Row, TableName } from "@antibody/core";
import { paths, readRows, writeRows } from "@antibody/core/node";

/** lda_filings, lda_lobbyists and lda_clients are shared by every bill, so two runs must not interleave writes. */
async function locked<T>(fn: () => Promise<T>): Promise<T> {
  const lock = join(paths.table("lda_filings"), "..", ".lobbying.lock");
  await mkdir(join(lock, ".."), { recursive: true });
  for (let waited = 0; ; waited += 200) {
    try {
      await mkdir(lock);
      break;
    } catch {
      if (waited > 120_000) throw new Error(`lock held for 2 minutes: ${lock}`);
      await Bun.sleep(200);
    }
  }
  try {
    return await fn();
  } finally {
    await rmdir(lock);
  }
}

/**
 * Merges rows into shared shards by id. `merge` combines an existing row with the incoming one;
 * `finish` rewrites a whole shard after the merge (e.g. recomputing which filings are superseded).
 */
export function upsert<T extends TableName>(
  table: T,
  rows: Row<T>[],
  shardOf: (row: Row<T>) => string,
  opts: {
    merge?: (old: Row<T>, incoming: Row<T>) => Row<T>;
    prepare?: (existing: Row<T>[]) => Row<T>[];
    finish?: (rows: Row<T>[]) => Row<T>[];
    /** Shards to rewrite even when no incoming row lands in them (so `prepare` can drop stale rows). */
    alsoShards?: string[];
  } = {},
): Promise<void> {
  const byShard = new Map<string, Row<T>[]>();
  for (const s of opts.alsoShards ?? []) byShard.set(s, []);
  for (const r of rows) byShard.set(shardOf(r), [...(byShard.get(shardOf(r)) ?? []), r]);
  return locked(async () => {
    for (const [shard, incoming] of byShard) {
      const existing = (opts.prepare ?? ((x) => x))(await readRows(table, shard));
      const merged = new Map(existing.map((r) => [r.id, r]));
      for (const r of incoming) {
        const old = merged.get(r.id);
        merged.set(r.id, old && opts.merge ? opts.merge(old, r) : r);
      }
      await writeRows(table, shard, (opts.finish ?? ((x) => x))([...merged.values()]));
    }
  });
}
