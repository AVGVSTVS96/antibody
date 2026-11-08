import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { billRef } from "@antibody/core";
import type { BillId, Stage, StageContext } from "@antibody/core";
import { heavy, paths, readRows, writeRows } from "@antibody/core/node";
import { memberLookup } from "@antibody/ingest-members";
import { cyclesFor } from "./bulk.ts";
import { readPacs, readPas2 } from "./pas2.ts";

export { cyclesFor } from "./bulk.ts";

export { EMPLOYER_MIN_USD, employerKey } from "./employers.ts";

export { CONTRIBUTION_TYPES, givingUrl } from "./pas2.ts";

const has = async (table: "contributions" | "employer_contributions", shard: string) =>
  await Bun.file(join(paths.table(table), `${shard}.jsonl`)).exists();

const loadedCycles = async () =>
  (await readdir(paths.table("contributions")).catch((): string[] => []))
    .flatMap((f) => /^pas2-(\d{4})\.jsonl$/u.exec(f)?.[1] ?? [])
    .map(Number);

function billOf(ctx: StageContext): BillId {
  if (ctx.bill === null) {
    throw new Error("this stage runs per bill");
  }

  return ctx.bill;
}

export const stages: Stage[] = [
  {
    name: "fec",
    scope: "bill",
    needs: ["members"],
    writes: ["contributions", "independent_expenditures", "pacs"],
    async run(ctx) {
      const { byFec } = await memberLookup();
      const fresh = [];

      for (const cycle of cyclesFor(billRef(billOf(ctx)).congress)) {
        if (!ctx.refresh && (await has("contributions", `pas2-${cycle}`))) {
          continue;
        }

        const { contributions, independent, skipped } = await readPas2(cycle, byFec);
        await writeRows("contributions", `pas2-${cycle}`, contributions);
        await writeRows("independent_expenditures", `pas2-${cycle}`, independent);
        ctx.log(
          `${cycle}: ${contributions.length} PAC contributions, ${independent.length} independent expenditures (skipped ${skipped.memo} memo, ${skipped.badDate} undated)`,
        );
        fresh.push(cycle);
      }

      if (fresh.length === 0 && (await readRows("pacs", "cm")).length > 0) {
        ctx.log("cycles cached");

        return;
      }

      const ids = new Set(
        [...(await readRows("contributions")), ...(await readRows("independent_expenditures"))].map((r) => r.pac_id),
      );

      const pacs = await readPacs(await loadedCycles(), ids);
      await writeRows("pacs", "cm", pacs);
      ctx.log(`${pacs.length} committees that gave to or spent on members`);
    },
  },
  {
    name: "fec-employers",
    scope: "bill",
    needs: ["members"],
    writes: ["employer_contributions"],
    async run(ctx) {
      for (const cycle of cyclesFor(billRef(billOf(ctx)).congress)) {
        if (!ctx.refresh && (await has("employer_contributions", `indiv-${cycle}`))) {
          ctx.log(`${cycle}: cached`);
          continue;
        }

        const out = await heavy(["bun", join(import.meta.dir, "employers-main.ts"), String(cycle)]);
        ctx.log(out.trim());
      }
    },
  },
];
