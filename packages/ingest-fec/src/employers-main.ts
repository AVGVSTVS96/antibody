import { writeRows } from "@antibody/core/node";
import { memberLookup } from "@antibody/ingest-members";
import { aggregateEmployers, EMPLOYER_MIN_USD, memberCommittees } from "./employers.ts";

/** Run by the fec-employers stage under a memory cap: `bun employers-main.ts <cycle>`. Prints its stats as JSON. */
const cycle = Number(Bun.argv[2]);
const { byFec } = await memberLookup();
const committees = await memberCommittees(cycle, byFec);
const { rows, stats } = await aggregateEmployers(cycle, committees, EMPLOYER_MIN_USD);
await writeRows("employer_contributions", `indiv-${cycle}`, rows);
console.log(
  JSON.stringify({
    cycle,
    committees: committees.size,
    members: new Set(committees.values()).size,
    ...stats,
    written: rows.length,
  }),
);
