import type { Stage } from "@antibody/core";
import { stages as bills } from "@antibody/ingest-bills";
import { xray } from "./xray.ts";

const sectionStages = bills.filter((s) => s.writes.includes("sections")).map((s) => s.name);

export const stages: Stage[] = [
  {
    name: "cbo",
    scope: "bill",
    needs: sectionStages,
    writes: ["cbo_estimates", "cbo_lines"],
    run: xray,
  },
];
