import type { Stage } from "@antibody/core";
import { writeRows } from "@antibody/core/node";
import { collect } from "./news.ts";
import { OUTLET_LIST, outletRows } from "./outlets.ts";

export { countsBySource } from "./mediacloud.ts";

export { articleText, defaultTerms, SAMPLE, searchPlan, termsFor } from "./news.ts";

export {
  COUNTED,
  midpoint,
  OUTLET_LIST,
  outletFor,
  outletRows,
  OUTLETS,
  PARTISAN_GROUPS,
  SIDE_NAMES,
  SIDES,
  sideOf,
  TRADE_LEGAL,
} from "./outlets.ts";

export type { Group, Outlet, Partisan, Side } from "./outlets.ts";

export const stages: Stage[] = [
  {
    name: "outlets",
    scope: "global",
    needs: [],
    writes: ["outlets"],
    run: async (ctx) => {
      await writeRows("outlets", OUTLET_LIST.version, outletRows());
      ctx.log(`outlet list ${OUTLET_LIST.version}: ${OUTLET_LIST.outlets.length} outlets`);
    },
  },
  {
    name: "news",
    scope: "bill",
    needs: ["outlets", "bills"],
    writes: ["articles"],
    run: async (ctx) => {
      await collect(ctx);
    },
  },
];
