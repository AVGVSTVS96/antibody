import { join } from "node:path";
import type { Stage } from "@antibody/core";
import { heavy } from "@antibody/core/node";

/**
 * `bills`: BILLSTATUS + every text version from GovInfo → sections and their lineage, sponsors, committees,
 * amendments with who offered them, and LLM counterparts for rewritten sections. Runs in its own memory-capped process.
 */
export const stages: Stage[] = [
  {
    name: "bills",
    scope: "bill",
    needs: [],
    writes: [
      "bills",
      "versions",
      "sections",
      "sponsorships",
      "bill_committees",
      "amendments",
      "amendment_sections",
      "counterparts",
    ],
    async run(ctx) {
      await heavy(["bun", join(import.meta.dir, "run.ts"), ctx.bill!, ...(ctx.refresh ? ["--refresh"] : [])]);
    },
  },
];

export { ingestBill } from "./ingest.ts";
export { type SectionText, sectionTexts } from "./texts.ts";
