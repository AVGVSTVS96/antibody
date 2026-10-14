import type { Row } from "@antibody/core";

type Trade = Row<"trades">;

export interface Filed {
  filedOn: string;
  amended: boolean;
}

const groupKey = (t: Trade) =>
  [t.bioguide ?? t.filer_name, t.owner, t.asset.toLowerCase(), t.traded_on ?? "", t.type].join("|");
const amountsOf = (rows: Trade[]) =>
  rows
    .map((t) => t.amount)
    .sort()
    .join(";");

/**
 * One row per trade: when a later filing reports the same trades again, only one filing's rows stay.
 * The same filer, owner, asset, date and type form a group. Within a group, an amended filing replaces the rows of
 * every earlier filing, and a later filing with exactly the same amounts is a re-filing and is dropped. A filing that
 * differs and is not an amendment is kept beside the earlier one. Kept rows list what they replaced in `raw`.
 */
export function collapseRestated(trades: Trade[], docs: Map<string, Filed>): Trade[] {
  const groups = new Map<string, Map<string, Trade[]>>();
  for (const t of trades) {
    const key = groupKey(t);
    const byDoc = groups.get(key) ?? new Map<string, Trade[]>();
    byDoc.set(t.document_id, [...(byDoc.get(t.document_id) ?? []), t]);
    groups.set(key, byDoc);
  }
  const dropped = new Set<string>();
  const notes = new Map<string, Record<string, string[]>>();
  const note = (rows: Trade[], key: string, ids: string[]) => {
    for (const r of rows) {
      const mine = notes.get(r.id) ?? {};
      notes.set(r.id, { ...mine, [key]: [...(mine[key] ?? []), ...ids] });
    }
  };
  for (const byDoc of groups.values()) {
    if (byDoc.size < 2) continue;
    const filed = (d: string) => docs.get(d)?.filedOn ?? "";
    const order = [...byDoc.keys()].sort(
      (a, b) => filed(a).localeCompare(filed(b)) || a.localeCompare(b, undefined, { numeric: true }),
    );
    const kept: string[] = [];
    for (const doc of order) {
      const rows = byDoc.get(doc) as Trade[];
      if (docs.get(doc)?.amended && kept.length) {
        const replaced = kept.splice(0).flatMap((k) => byDoc.get(k) as Trade[]);
        for (const r of replaced) dropped.add(r.id);
        note(
          rows,
          "restates",
          replaced.map((r) => r.id),
        );
        kept.push(doc);
        continue;
      }
      const twin = kept.find((k) => amountsOf(byDoc.get(k) as Trade[]) === amountsOf(rows));
      if (twin) {
        for (const r of rows) dropped.add(r.id);
        note(byDoc.get(twin) as Trade[], "also_filed_in", [doc]);
      } else kept.push(doc);
    }
  }
  return trades
    .filter((t) => !dropped.has(t.id))
    .map((t) => {
      const extra = notes.get(t.id);
      return extra ? { ...t, raw: { ...(t.raw as object), ...extra } } : t;
    });
}
