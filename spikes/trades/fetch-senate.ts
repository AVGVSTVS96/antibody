import { mkdir, exists } from "node:fs/promises";

const base = "https://efdsearch.senate.gov";
const root = `${import.meta.dir}/../../data/trades/senate`;
const since = Bun.argv[2] ?? "01/01/2024";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const jar = new Map<string, string>();
async function get(path: string, init: RequestInit = {}) {
  const res = await fetch(base + path, {
    ...init,
    redirect: "manual",
    headers: { "User-Agent": UA, Referer: `${base}/search/`, Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), ...init.headers },
  });
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return res;
}

async function session() {
  const home = await (await get("/search/home/")).text();
  const token = home.match(/name="csrfmiddlewaretoken" value="([^"]+)"/)![1];
  const agreed = await get("/search/home/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ prohibition_agreement: "1", csrfmiddlewaretoken: token }),
  });
  if (agreed.status !== 302) throw new Error(`terms POST returned ${agreed.status}`);
}

type Report = { first: string; last: string; office: string; kind: "ptr" | "paper"; id: string; title: string; filed: string; url: string };

async function listReports(): Promise<Report[]> {
  const out: Report[] = [];
  for (let start = 0; ; start += 100) {
    const body = new URLSearchParams({
      start: String(start), length: "100", report_types: "[11]", filer_types: "[]",
      submitted_start_date: `${since} 00:00:00`, submitted_end_date: "", candidate_state: "", senator_state: "",
      office_id: "", first_name: "", last_name: "", csrfmiddlewaretoken: jar.get("csrftoken")!,
    });
    const res = await get("/search/report/data/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-CSRFToken": jar.get("csrftoken")! },
      body,
    });
    const page = (await res.json()) as { recordsTotal: number; data: string[][] };
    for (const [first, last, office, link, filed] of page.data) {
      const [, path, kind, id, title] = link.match(/href="(\/search\/view\/(ptr|paper)\/([^/]+)\/)"[^>]*>([^<]+)</)!;
      out.push({ first, last, office, kind: kind as Report["kind"], id, title, filed, url: base + path });
    }
    if (start + 100 >= page.recordsTotal) return out;
  }
}

await mkdir(`${root}/pages`, { recursive: true });
await session();
const reports = await listReports();
await Bun.write(`${root}/reports.json`, JSON.stringify(reports, null, 1));

let fetched = 0, blocked = 0;
for (const r of reports) {
  const path = `${root}/pages/${r.id}.html`;
  if (await exists(path)) continue;
  const res = await get(new URL(r.url).pathname);
  const html = await res.text();
  const expected = r.kind === "ptr" ? "<table" : "filingImage";
  if (res.status !== 200 || !html.includes(expected)) { blocked++; console.error(res.status, r.url); if (blocked > 5) break; continue; }
  await Bun.write(path, html);
  fetched++;
  await Bun.sleep(250);
}
console.log({ reports: reports.length, ptr: reports.filter((r) => r.kind === "ptr").length, paper: reports.filter((r) => r.kind === "paper").length, fetched, blocked });
