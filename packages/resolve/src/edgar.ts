import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Row } from "@antibody/core";
import { filled } from "@antibody/core";
import { paths } from "@antibody/core/node";
import { isObject, isText } from "./is.ts";

// https://www.sec.gov/os/accessing-edgar-data
const HEADERS = { "User-Agent": "antibody (nonpartisan bill research) hex-ai@agentmail.to" };
export const TICKERS_URL = "https://www.sec.gov/files/company_tickers_exchange.json";
export const companyUrl = (cik: string) => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}`;

export interface Company {
  cik: string;
  name: string;
  tickers: string[];
  exchange: string | null;
}

interface TickerFile {
  fields: string[];
  data: unknown[][];
}

const isList = (v: unknown): v is unknown[] => Array.isArray(v);

const isTickerFile = (v: unknown): v is TickerFile =>
  isObject(v) &&
  "fields" in v &&
  isList(v.fields) &&
  v.fields.every(isText) &&
  "data" in v &&
  isList(v.data) &&
  v.data.every(isList);

const dir = () => paths.raw("sec");

export async function loadEdgar(refresh = false): Promise<Company[]> {
  const file = join(dir(), "company_tickers_exchange.json");

  if (refresh || !(await Bun.file(file).exists())) {
    await mkdir(dir(), { recursive: true });
    const res = await fetch(TICKERS_URL, { headers: HEADERS });

    if (!res.ok) {
      throw new Error(`SEC ticker list: HTTP ${res.status}`);
    }

    await Bun.write(file, await res.text());
  }

  const list: unknown = await Bun.file(file).json();

  if (!isTickerFile(list)) {
    throw new Error(`${file}: not SEC's {fields, data} ticker list`);
  }

  const { fields, data } = list;
  const at = (k: string) => fields.indexOf(k);
  const byCik = new Map<string, Company>();

  for (const r of data) {
    const cik = String(r[at("cik")]);
    const c = byCik.get(cik) ?? { cik, name: String(r[at("name")]), tickers: [], exchange: null };
    c.tickers.push(String(r[at("ticker")]));
    const exchange = r[at("exchange")];
    c.exchange ??= isText(exchange) ? exchange : null;
    byCik.set(cik, c);
  }

  return [...byCik.values()];
}

export function companyRows(companies: Company[], sic: Map<string, string>): Row<"companies">[] {
  return companies.map((c, i) => ({
    id: c.cik,
    name: c.name,
    tickers: c.tickers,
    exchange: c.exchange,
    sic: sic.get(c.cik) ?? null,
    source_url: companyUrl(c.cik),
    source_locator: `company_tickers_exchange.json, CIK ${c.cik} (company ${i + 1})`,
  }));
}

const submissionsDir = () => join(dir(), "submissions");
const submissionsFile = (cik: string) => join(submissionsDir(), `CIK${cik.padStart(10, "0")}.json`);

export async function fetchSubmissions(ciks: Iterable<string>, log: (m: string) => void): Promise<void> {
  await mkdir(submissionsDir(), { recursive: true });
  let fetched = 0;

  for (const cik of ciks) {
    if (await Bun.file(submissionsFile(cik)).exists()) {
      continue;
    }

    const res = await fetch(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`, { headers: HEADERS });

    if (!res.ok) {
      continue;
    }

    const j: unknown = await res.json();

    if (!isObject(j)) {
      throw new Error(`SEC submissions for CIK ${cik}: not a JSON object`);
    }

    await Bun.write(
      submissionsFile(cik),
      JSON.stringify({
        sic: "sic" in j ? j.sic : undefined,
        sicDescription: "sicDescription" in j ? j.sicDescription : undefined,
        formerNames: "formerNames" in j ? j.formerNames : undefined,
      }),
    );
    fetched++;
    await Bun.sleep(120);
  }

  if (fetched > 0) {
    log(`fetched ${fetched} SEC submissions files`);
  }
}

export async function cachedSic(): Promise<Map<string, string>> {
  const out = new Map<string, string>();

  const files = await Array.fromAsync(new Bun.Glob("CIK*.json").scan({ cwd: submissionsDir() })).catch(
    (): string[] => [],
  );

  for (const f of files) {
    const j: unknown = await Bun.file(join(submissionsDir(), f)).json();
    const sic = isObject(j) && "sic" in j ? j.sic : undefined;

    if (isText(sic) && filled(sic)) {
      out.set(String(Number(f.slice(3, 13))), sic);
    }
  }

  return out;
}
