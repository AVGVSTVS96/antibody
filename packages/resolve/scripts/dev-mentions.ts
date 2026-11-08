import { join } from "node:path";
import { filled } from "@antibody/core";
import { paths } from "@antibody/core/node";
import { isObject, isText, isTextOrNull } from "../src/is.ts";
import type { Mention } from "../src/match.ts";
import { STOCK_TYPES } from "../src/mentions.ts";

const lines = async (file: string) => (await Bun.file(file).text()).split("\n").filter(Boolean);

function clientKey(name: string) {
  return name
    .toUpperCase()
    .replace(/^.*\b(?:OBO|ON BEHALF OF|O\/B\/O)\b/u, "")
    .replaceAll(/\(.*?\)/gu, " ")
    .replaceAll("&", " AND ")
    .replaceAll(/[^A-Z0-9 ]+/gu, " ")
    .replaceAll(
      /\b(THE|INC|INCORPORATED|LLC|L L C|LP|LLP|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|HOLDINGS?|GROUP|N A|NA|USA|U S A|US|U S|AND AFFILIATES|AFFILIATES|AND ITS SUBSIDIARIES|AND VARIOUS SUBSIDIARIES|SUBSIDIARIES)\b/gu,
      " ",
    )
    .replaceAll(/\s+/gu, " ")
    .trim()
    .toLowerCase()
    .replaceAll(" ", "-");
}

interface Filing {
  client: { name: string; general_description: string | null };
}

const isFiling = (v: unknown): v is Filing =>
  isObject(v) &&
  "client" in v &&
  isObject(v.client) &&
  "name" in v.client &&
  isText(v.client.name) &&
  "general_description" in v.client &&
  isTextOrNull(v.client.general_description);

interface Trade {
  asset: string;
  asset_type: string | null;
  ticker: string | null;
  doc_id?: string | null;
  report_id?: string | null;
}

const isTrade = (v: unknown): v is Trade =>
  isObject(v) &&
  "asset" in v &&
  isText(v.asset) &&
  "asset_type" in v &&
  isTextOrNull(v.asset_type) &&
  "ticker" in v &&
  isTextOrNull(v.ticker) &&
  (!("doc_id" in v) || isTextOrNull(v.doc_id)) &&
  (!("report_id" in v) || isTextOrNull(v.report_id));

const parse = <T>(line: string, is: (v: unknown) => v is T): T => {
  const v: unknown = JSON.parse(line);

  if (!is(v)) {
    throw new Error(`unexpected record: ${line.slice(0, 200)}`);
  }

  return v;
};

const out: (Mention & { bills?: string[] })[] = [];

const clients = new Map<string, { names: Map<string, number>; desc: string | null; bills: Set<string> }>();

for (const bill of ["genius", "ira", "obbba"]) {
  for (const l of await lines(join(paths.raw("lobbying"), bill, "filings.jsonl"))) {
    const f = parse(l, isFiling);
    const k = clientKey(f.client.name);

    if (!k) {
      continue;
    }

    const c = clients.get(k) ?? { names: new Map(), desc: f.client.general_description, bills: new Set() };
    c.names.set(f.client.name, (c.names.get(f.client.name) ?? 0) + 1);
    c.bills.add(bill);
    clients.set(k, c);
  }
}

for (const [k, c] of clients) {
  const [name, ...aka] = [...c.names].toSorted((a, b) => b[1] - a[1]).map(([n]) => n);

  if (name === undefined) {
    continue;
  }

  out.push({
    src: `client:${k}`,
    source: "client",
    name,
    ticker: null,
    context: [aka.slice(0, 4).join("; "), c.desc].filter(Boolean).join(" | ") || null,
    restsOn: [`lda_clients/${k}`],
    bills: [...c.bills],
  });
}

const gave = new Set<string>();

for (const cycle of ["24", "26"]) {
  for (const l of await lines(join(paths.raw("entities"), "fec", `pas2${cycle}`, "itpas2.txt"))) {
    const [committee = ""] = l.split("|");
    gave.add(committee);
  }
}

const seen = new Set<string>();

for (const cycle of ["26", "24"]) {
  for (const l of await lines(join(paths.raw("entities"), "fec", `cm${cycle}`, "cm.txt"))) {
    const f = l.split("|");
    const [id, name] = f;
    const dsgn = f[8];
    const tp = f[9];
    const org = f[13];

    if (!filled(id) || seen.has(id) || !gave.has(id) || dsgn === "D" || !["Q", "N"].includes(tp ?? "")) {
      continue;
    }

    seen.add(id);
    const connected = filled(org) && !/^(NONE|N\/?A|NULL)$/iu.test(org.trim()) ? org : null;

    out.push({
      src: `pac:${id}`,
      source: "pac",
      name: connected ?? name ?? "",
      ticker: null,
      context: connected === null ? null : `PAC name: ${name ?? ""}`,
      restsOn: [`pacs/${id}`],
    });
  }
}

let n = 0;

for (const chamber of ["house", "senate"]) {
  for (const l of await lines(join(paths.raw("trades"), `${chamber}-trades.jsonl`))) {
    const t = parse(l, isTrade);

    if (!STOCK_TYPES.has(t.asset_type ?? "")) {
      continue;
    }

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
}

console.log(JSON.stringify(out));

console.error(
  Object.entries(Object.groupBy(out, (m) => m.source))
    .map(([k, v]) => `${k}: ${v.length}`)
    .join(", "),
);
