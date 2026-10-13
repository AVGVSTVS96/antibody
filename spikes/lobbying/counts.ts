import { count } from "./lda";
const queries = process.argv.slice(2);
for (const q of queries) console.log(String(await count({ filing_specific_lobbying_issues: q })).padStart(7), q);
