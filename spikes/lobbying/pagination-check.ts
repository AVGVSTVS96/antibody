import { allFilings } from "./lda";
import { bills } from "./bills";
const bill = bills.find((b) => b.key === "genius")!;
const sets: Set<string>[] = [];
for (const ordering of ["dt_posted", "-dt_posted", ""]) {
  const ids = new Set<string>();
  const p: any = { filing_specific_lobbying_issues: bill.search.join(" OR "), filing_year: 2026 };
  if (ordering) p.ordering = ordering;
  for await (const f of allFilings(p)) ids.add(f.filing_uuid);
  sets.push(ids);
}
const union = new Set(sets.flatMap((s) => [...s]));
console.log({ sizes: sets.map((s) => s.size), union: union.size });
