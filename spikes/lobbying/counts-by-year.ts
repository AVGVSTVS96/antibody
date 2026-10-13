import { count } from "./lda";
const [query, ...years] = process.argv.slice(2);
for (const y of years) console.log(y, await count({ filing_specific_lobbying_issues: query!, filing_year: y }));
