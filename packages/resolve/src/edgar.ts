import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Row } from "@antibody/core";
import { paths } from "@antibody/core/node";

/** SEC asks scripts to name themselves with a contact address. */
const HEADERS = { "User-Agent": "antibody (nonpartisan bill research) hex-ai@agentmail.to" };
export const TICKERS_URL = "https://www.sec.gov/files/company_tickers_exchange.json";
export const companyUrl = (cik: string) => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}`;

export interface Company {
  cik: string;
  name: string;
  tickers: string[];
  exchange: string | null;
}

const dir = () => paths.raw("sec");

/** SEC's ticker list (every company with a listed ticker), downloaded once and refreshed on --refresh. */
export async function loadEdgar(refresh = false): Promise<Company[]> {
  const file = join(dir(), "company_tickers_exchange.json");
  if (refresh || !(await Bun.file(file).exists())) {
    await mkdir(dir(), { recursive: true });
    const res = await fetch(TICKERS_URL, { headers: HEADERS });
    if (!res.ok) throw new Error(`SEC ticker list: HTTP ${res.status}`);
    await Bun.write(file, await res.text());
  }
  const { fields, data } = (await Bun.file(file).json()) as { fields: string[]; data: unknown[][] };
  const at = (k: string) => fields.indexOf(k);
  const byCik = new Map<string, Company>();
  for (const r of data) {
    const cik = String(r[at("cik")]);
    const c = byCik.get(cik) ?? { cik, name: String(r[at("name")]), tickers: [], exchange: null };
    c.tickers.push(String(r[at("ticker")]));
    c.exchange ??= (r[at("exchange")] as string | null) ?? null;
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

/**
 * Fetches EDGAR submissions files (SIC code, former names) for CIKs not fetched yet, at SEC's 10-requests-a-second
 * limit. Only resolved companies are fetched; SIC feeds the separate sector layer.
 */
export async function fetchSubmissions(ciks: Iterable<string>, log: (m: string) => void): Promise<void> {
  await mkdir(submissionsDir(), { recursive: true });
  let fetched = 0;
  for (const cik of ciks) {
    if (await Bun.file(submissionsFile(cik)).exists()) continue;
    const res = await fetch(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`, { headers: HEADERS });
    if (!res.ok) continue;
    const j = (await res.json()) as Record<string, unknown>;
    await Bun.write(
      submissionsFile(cik),
      JSON.stringify({ sic: j.sic, sicDescription: j.sicDescription, formerNames: j.formerNames }),
    );
    fetched++;
    await Bun.sleep(120);
  }
  if (fetched) log(`fetched ${fetched} SEC submissions files`);
}

/** SIC codes for every company whose submissions file has been fetched. */
export async function cachedSic(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const files = await Array.fromAsync(new Bun.Glob("CIK*.json").scan({ cwd: submissionsDir() })).catch(
    () => [] as string[],
  );
  for (const f of files) {
    const { sic } = (await Bun.file(join(submissionsDir(), f)).json()) as { sic?: string };
    if (sic) out.set(String(Number(f.slice(3, 13))), sic);
  }
  return out;
}
