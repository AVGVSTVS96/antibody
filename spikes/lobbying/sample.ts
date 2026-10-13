const [billKey, n = "30", seed = "1", conf = "high,medium"] = process.argv.slice(2);
const path = new URL(`../../data/lobbying/${billKey}/matches.jsonl`, import.meta.url).pathname;
const all = (await Bun.file(path).text()).trim().split("\n").map((l) => JSON.parse(l));
const pool = all.filter((m) => conf.split(",").includes(m.confidence));
let s = Number(seed);
const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const picked = new Set<number>();
while (picked.size < Math.min(Number(n), pool.length)) picked.add(Math.floor(rand() * pool.length));
let i = 0;
for (const idx of picked) {
  const m = pool[idx];
  const a = m.activities[0];
  const r = a.refs[0];
  const at = a.description.search(new RegExp(r.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?!\\d|-\\d)"));
  const snip = a.description.slice(Math.max(0, at - 110), at + r.text.length + 110).replace(/\s+/g, " ");
  console.log(`#${++i} ${m.confidence} ${m.filing_year} ${m.filing_period} ${m.client.name} | ref="${r.text}" (${r.how}; ${r.why})\n   ${m.filing_url}\n   …${snip}…\n`);
}
