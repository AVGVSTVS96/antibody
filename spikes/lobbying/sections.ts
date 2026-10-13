const billKey = process.argv[2]!;
const re = new RegExp(process.argv[3]!, "gi");
const rows = (await Bun.file(new URL(`../../data/lobbying/${billKey}/matches.jsonl`, import.meta.url).pathname).text()).trim().split("\n").map((l) => JSON.parse(l)).filter((m) => m.confidence !== "low" && !m.superseded);
const counts = new Map<string, Set<string>>();
let filings = 0;
for (const m of rows) {
  let any = false;
  for (const a of m.activities) for (const x of a.description.matchAll(re)) {
    any = true;
    const k = x[1];
    if (!counts.has(k)) counts.set(k, new Set());
    counts.get(k)!.add(m.client.name);
  }
  if (any) filings++;
}
console.log(JSON.stringify({ filings_citing_sections: filings, of: rows.length, distinct_sections: counts.size, top: [...counts].sort((a, b) => b[1].size - a[1].size).slice(0, 12).map(([k, v]) => [k, v.size, [...v].slice(0, 3)]) }));
