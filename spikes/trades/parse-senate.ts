const root = `${import.meta.dir}/../../data/trades/senate`;
type Report = { first: string; last: string; office: string; kind: "ptr" | "paper"; id: string; title: string; filed: string; url: string };
const reports: Report[] = await Bun.file(`${root}/reports.json`).json();

const text = (html: string) =>
  html.replace(/<div class="text-muted">[\s\S]*?<\/div>/g, (m) => " | " + m)
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

const out: string[] = [];
let tables = 0, rows = 0;
for (const r of reports.filter((r) => r.kind === "ptr")) {
  const html = await Bun.file(`${root}/pages/${r.id}.html`).text();
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1];
  if (!body) continue;
  tables++;
  for (const tr of body.match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
    const td = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => text(m[1]));
    if (td.length < 9) continue;
    const [n, date, owner, ticker, asset, assetType, type, amount, comment] = td;
    out.push(JSON.stringify({
      chamber: "senate", report_id: r.id, url: r.url, filer: `${r.first} ${r.last}`, office: r.office, filed: r.filed,
      n: Number(n), date, owner, ticker: ticker === "--" ? null : ticker.replace(/\s.*$/, ""), asset: asset.split(" | ")[0], asset_detail: asset.split(" | ").slice(1).join(" | ") || null,
      asset_type: assetType, type, amount, comment: comment === "--" ? null : comment,
    }));
    rows++;
  }
}
await Bun.write(`${root}/../senate-trades.jsonl`, out.join("\n") + "\n");
console.log({ ptrReports: reports.filter((r) => r.kind === "ptr").length, paperReports: reports.filter((r) => r.kind === "paper").length, tables, rows });
