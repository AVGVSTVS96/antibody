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
    .toSorted()
    .join(";");

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
    if (byDoc.size < 2) {
      continue;
    }

    const filed = (d: string) => docs.get(d)?.filedOn ?? "";

    const order = [...byDoc].toSorted(
      ([a], [b]) => filed(a).localeCompare(filed(b)) || a.localeCompare(b, undefined, { numeric: true }),
    );

    const kept: [string, Trade[]][] = [];

    for (const [doc, rows] of order) {
      if (docs.get(doc)?.amended === true && kept.length) {
        const replaced = kept.splice(0).flatMap(([, r]) => r);

        for (const r of replaced) {
          dropped.add(r.id);
        }

        note(
          rows,
          "restates",
          replaced.map((r) => r.id),
        );
        kept.push([doc, rows]);
        continue;
      }

      const twin = kept.find(([, r]) => amountsOf(r) === amountsOf(rows));

      if (twin) {
        for (const r of rows) {
          dropped.add(r.id);
        }

        note(twin[1], "also_filed_in", [doc]);
      } else {
        kept.push([doc, rows]);
      }
    }
  }

  return trades.flatMap((t) => {
    if (dropped.has(t.id)) {
      return [];
    }

    const extra = notes.get(t.id);

    return [extra ? { ...t, raw: { ...t.raw, ...extra } } : t];
  });
}
