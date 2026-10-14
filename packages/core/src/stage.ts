import type { BillId } from "./ids.ts";
import type { TableName } from "./tables.ts";

/**
 * How a package plugs into the CLI. Each package's index exports `stages: Stage[]`; apps/cli imports them all.
 * `antibody xray <bill>` runs every bill stage in dependency order (global stages too, when their tables are
 * empty or `--refresh` is set), then builds the bundle.
 */
export interface Stage {
  /** Unique, short: "bills", "cbo", "trades", "trades-vision" … */
  name: string;
  /** bill: runs per bill (ctx.bill set). global: refreshes shared data (all trades, FEC, members). */
  scope: "bill" | "global";
  /** Stage names whose tables this reads. */
  needs: string[];
  /** Tables this writes; each must be owned by this stage's package (see TABLES). */
  writes: TableName[];
  run(ctx: StageContext): Promise<void>;
}

export interface StageContext {
  bill: BillId | null;
  refresh: boolean;
  log(message: string): void;
  signal: AbortSignal;
}
