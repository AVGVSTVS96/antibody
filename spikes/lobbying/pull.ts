import { mkdir } from "node:fs/promises";
import { allFilings, count } from "./lda";
import { bills } from "./bills";

const keys = process.argv.slice(2);
const out = new URL("../../data/lobbying/", import.meta.url).pathname;
for (const bill of bills.filter((b) => !keys.length || keys.includes(b.key))) {
  await mkdir(out + bill.key, { recursive: true });
  const seen = new Map<string, any>();
  for (const year of bill.years) {
    const params = { filing_specific_lobbying_issues: bill.search.join(" OR "), filing_year: year };
    console.error(bill.key, year, await count(params), "filings");
    for await (const f of allFilings(params)) seen.set(f.filing_uuid, f);
  }
  await Bun.write(out + bill.key + "/filings.jsonl", [...seen.values()].map((f) => JSON.stringify(f)).join("\n") + "\n");
  console.error(bill.key, "saved", seen.size);
}
