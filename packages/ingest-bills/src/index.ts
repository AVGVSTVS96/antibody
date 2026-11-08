import { join } from "node:path";
import type { Stage } from "@antibody/core";
import { heavy } from "@antibody/core/node";

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
    async run({ bill, refresh }) {
      if (bill === null) {
        throw new Error("the bills stage runs for one bill");
      }

      await heavy(["bun", join(import.meta.dir, "run.ts"), bill, ...(refresh ? ["--refresh"] : [])]);
    },
  },
];

export { ingestBill } from "./ingest.ts";

export { PARTS, PARTS_TEXT, type Piece, type SectionPart, sectionParts, splitSection } from "./parts.ts";

export { type SectionText, sectionTexts } from "./texts.ts";
