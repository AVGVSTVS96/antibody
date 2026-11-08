import type { BillId } from "./ids.ts";
import type { TableName } from "./tables.ts";

export interface Stage {
  name: string;
  scope: "bill" | "global";
  needs: string[];
  writes: TableName[];
  run: (ctx: StageContext) => Promise<void>;
}

export interface StageContext {
  bill: BillId | null;
  refresh: boolean;
  log: (message: string) => void;
  signal: AbortSignal;
}
