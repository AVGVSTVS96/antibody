import { createHash } from "node:crypto";
import { filingsUrl } from "./lda";
import { bills } from "./bills";

const billKey = process.argv[2]!;
const bill = bills.find((b) => b.key === billKey)!;
const cache = new URL("../../data/lobbying/cache/", import.meta.url).pathname;
const seen = new Map<string, any>();
let pages = 0;
for (const year of bill.years) {
  const params = { filing_specific_lobbying_issues: bill.search.join(" OR "), filing_year: year };
  for (let page = 1; page < 2000; page++) {
    const f = Bun.file(cache + createHash("sha1").update(filingsUrl(params, page)).digest("hex") + ".json");
    if (!(await f.exists())) continue;
    pages++;
    for (const r of (await f.json()).results) seen.set(r.filing_uuid, r);
  }
}
const target = new URL(`../../data/lobbying/${billKey}/filings.jsonl`, import.meta.url).pathname;
if (!(await Bun.file(target).exists()) || process.argv[3] === "--force") await Bun.write(target, [...seen.values()].map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(billKey, "pages", pages, "filings", seen.size);
