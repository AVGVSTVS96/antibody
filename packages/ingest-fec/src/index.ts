import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { billRef, type Stage } from "@antibody/core";
import { heavy, paths, readRows, writeRows } from "@antibody/core/node";
import { memberLookup } from "@antibody/ingest-members";
import { cyclesFor } from "./bulk.ts";
import { readPacs, readPas2 } from "./pas2.ts";

export { cyclesFor } from "./bulk.ts";
export { EMPLOYER_MIN_USD, employerKey } from "./employers.ts";
export { CONTRIBUTION_TYPES, givingUrl } from "./pas2.ts";

const has = async (table: "contributions" | "employer_contributions", shard: string) =>
  Bun.file(join(paths.table(table), `${shard}.jsonl`)).exists();

const loadedCycles = async () =>
  (await readdir(paths.table("contributions")).catch(() => [] as string[]))
    .flatMap((f) => f.match(/^pas2-(\d{4})\.jsonl$/)?.[1] ?? [])
    .map(Number);

export const stages: Stage[] = [
  {
    name: "fec",
    scope: "bill",
    needs: ["members"],
    writes: ["contributions", "independent_expenditures", "pacs"],
    async run({ bill, refresh, log }) {
      const { byFec } = await memberLookup();
      const fresh = [];
      for (const cycle of cyclesFor(billRef(bill!).congress)) {
        if (!refresh && (await has("contributions", `pas2-${cycle}`))) continue;
        const { contributions, independent, skipped } = await readPas2(cycle, byFec);
        await writeRows("contributions", `pas2-${cycle}`, contributions);
        await writeRows("independent_expenditures", `pas2-${cycle}`, independent);
        log(
          `${cycle}: ${contributions.length} PAC contributions, ${independent.length} independent expenditures (skipped ${skipped.memo} memo, ${skipped.badDate} undated)`,
        );
        fresh.push(cycle);
      }
      if (!fresh.length && (await readRows("pacs", "cm")).length) return log("cycles cached");
      const ids = new Set(
        [...(await readRows("contributions")), ...(await readRows("independent_expenditures"))].map((r) => r.pac_id),
      );
      const pacs = await readPacs(await loadedCycles(), ids);
      await writeRows("pacs", "cm", pacs);
      log(`${pacs.length} committees that gave to or spent on members`);
    },
  },
  {
    name: "fec-employers",
    scope: "bill",
    needs: ["members"],
    writes: ["employer_contributions"],
    async run({ bill, refresh, log }) {
      for (const cycle of cyclesFor(billRef(bill!).congress)) {
        if (!refresh && (await has("employer_contributions", `indiv-${cycle}`))) {
          log(`${cycle}: cached`);
          continue;
        }
        const out = await heavy(["bun", join(import.meta.dir, "employers-main.ts"), String(cycle)]);
        log(out.trim());
      }
    },
  },
];
