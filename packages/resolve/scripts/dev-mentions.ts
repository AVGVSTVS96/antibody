/**
 * Builds resolve's inputs straight from the Phase 0 raw downloads (LD-2 filings for GENIUS, IRA and OBBBA; FEC
 * committee and PAC-to-candidate files; House and Senate PTR lines), shaped like the contract rows the ingest parts
 * will write. For measuring the resolver before those parts land; the stages read the real tables.
 *
 *   bun packages/resolve/scripts/dev-mentions.ts > $ANTIBODY_DATA/entities/resolve/dev-mentions.json
 */
import { join } from "node:path";
import { paths } from "@antibody/core/node";
import type { Mention } from "../src/match.ts";
import { STOCK_TYPES } from "../src/mentions.ts";

const lines = async (file: string) => (await Bun.file(file).text()).split("\n").filter(Boolean);

function clientKey(name: string) {
  return name
    .toUpperCase()
    .replace(/^.*\b(?:OBO|ON BEHALF OF|O\/B\/O)\b/, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(
      /\b(THE|INC|INCORPORATED|LLC|L L C|LP|LLP|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|HOLDINGS?|GROUP|N A|NA|USA|U S A|US|U S|AND AFFILIATES|AFFILIATES|AND ITS SUBSIDIARIES|AND VARIOUS SUBSIDIARIES|SUBSIDIARIES)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replaceAll(" ", "-");
}

const out: (Mention & { bills?: string[] })[] = [];

const clients = new Map<string, { names: Map<string, number>; desc: string | null; bills: Set<string> }>();
for (const bill of ["genius", "ira", "obbba"])
  for (const l of await lines(join(paths.raw("lobbying"), bill, "filings.jsonl"))) {
    const f = JSON.parse(l) as { client: { name: string; general_description: string | null } };
    const k = clientKey(f.client.name);
    if (!k) continue;
    const c = clients.get(k) ?? { names: new Map(), desc: f.client.general_description, bills: new Set() };
    c.names.set(f.client.name, (c.names.get(f.client.name) ?? 0) + 1);
    c.bills.add(bill);
    clients.set(k, c);
  }
for (const [k, c] of clients) {
  const names = [...c.names].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  out.push({
    src: `client:${k}`,
    source: "client",
    name: names[0]!,
    ticker: null,
    context: [names.slice(1, 5).join("; "), c.desc].filter(Boolean).join(" | ") || null,
    restsOn: [`lda_clients/${k}`],
    bills: [...c.bills],
  });
}

const gave = new Set<string>();
for (const cycle of ["24", "26"])
  for (const l of await lines(join(paths.raw("entities"), "fec", `pas2${cycle}`, "itpas2.txt")))
    gave.add(l.split("|")[0]!);
const seen = new Set<string>();
for (const cycle of ["26", "24"])
  for (const l of await lines(join(paths.raw("entities"), "fec", `cm${cycle}`, "cm.txt"))) {
    const [id, name, , , , , , , dsgn, tp, , , , org] = l.split("|");
    if (!id || seen.has(id) || !gave.has(id) || dsgn === "D" || !["Q", "N"].includes(tp ?? "")) continue;
    seen.add(id);
    const connected = org && !/^(NONE|N\/?A|NULL)$/i.test(org.trim()) ? org : null;
    out.push({
      src: `pac:${id}`,
      source: "pac",
      name: connected ?? name!,
      ticker: null,
      context: connected ? `PAC name: ${name}` : null,
      restsOn: [`pacs/${id}`],
    });
  }

let n = 0;
for (const chamber of ["house", "senate"])
  for (const l of await lines(join(paths.raw("trades"), `${chamber}-trades.jsonl`))) {
    const t = JSON.parse(l) as {
      asset: string;
      asset_type: string | null;
      ticker: string | null;
      doc_id?: string;
      report_id?: string;
    };
    if (!STOCK_TYPES.has(t.asset_type ?? "")) continue;
    const id = `${t.doc_id ?? t.report_id}-${n++}`;
    out.push({
      src: `trade:${id}`,
      source: "trade",
      name: t.asset,
      ticker: t.ticker,
      context: null,
      restsOn: [`trades/${id}`],
    });
  }

console.log(JSON.stringify(out));
console.error(
  Object.entries(Object.groupBy(out, (m) => m.source))
    .map(([k, v]) => `${k}: ${v!.length}`)
    .join(", "),
);
