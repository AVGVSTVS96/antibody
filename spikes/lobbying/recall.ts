import { allFilings, count } from "./lda";
import { findRefs } from "./extract";

const [billKey, query, ...years] = process.argv.slice(2);
const candidates = new Set(
  (await Bun.file(new URL(`../../data/lobbying/${billKey}/filings.jsonl`, import.meta.url).pathname).text())
    .trim().split("\n").map((l) => JSON.parse(l).filing_uuid),
);
let broad = 0, regexHits = 0, missed: any[] = [];
for (const year of years) {
  const params = { filing_specific_lobbying_issues: query!, filing_year: year };
  console.error(year, await count(params));
  for await (const f of allFilings(params)) {
    broad++;
    const refs = (f.lobbying_activities ?? []).flatMap((a: any) => findRefs(a.description ?? "", f.filing_year, f.filing_period, billKey!));
    if (!refs.some((r: any) => r.confidence !== "low")) continue;
    regexHits++;
    if (!candidates.has(f.filing_uuid)) missed.push({ url: f.filing_document_url, refs: refs.map((r: any) => r.text) });
  }
}
console.log(JSON.stringify({ billKey, query, years, broad, regexHits, missedByApiSearch: missed.length, missed: missed.slice(0, 10) }, null, 1));
