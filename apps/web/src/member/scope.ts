import type { NodeId } from "@antibody/core";
import type { BillModel } from "../lib/model.ts";
import { buildTape, type TapeRow } from "../lib/tape.ts";
import { companiesTiedTo } from "../lib/trades.ts";

/**
 * What a member's ties are counted against, the same for every member of a bill: the quiet and costly sections; when
 * the bill has none, the sections a lobbying client named by number; when no client did, the whole bill.
 */
export interface Scope {
  kind: "quiet" | "named" | "bill";
  /** Tape rows in bill order; empty for `bill`. */
  rows: TapeRow[];
  /** `quiet sections`, `sections a client named`, `companies that lobbied the bill`. */
  noun: readonly [one: string, many: string];
  /** Listed companies tied to any of the rows' sections (or to the bill). */
  companies: Set<NodeId>;
  /** Per section id, the companies tied to it. */
  bySection: Map<string, Set<NodeId>>;
}

export function scopeOf(m: BillModel): Scope {
  const rows = buildTape(m).rows;
  const quiet = rows.filter((r) => r.kind === "quiet");
  const named = rows.filter((r) => r.lobbying > 0);
  const [kind, picked, noun] =
    quiet.length > 0
      ? (["quiet", quiet, ["quiet section", "quiet sections"]] as const)
      : named.length > 0
        ? (["named", named, ["section a lobbying client named", "sections a lobbying client named"]] as const)
        : (["bill", [], ["company that lobbied the bill", "companies that lobbied the bill"]] as const);
  const bySection = new Map(picked.map((r) => [r.id, companiesTiedTo(m, [r.id])]));
  const companies =
    kind === "bill"
      ? new Set(m.actors.filter((a) => a.kind === "company" && a.lobbied.length > 0).map((a) => a.id))
      : companiesTiedTo(
          m,
          picked.map((r) => r.id),
        );
  return { kind, rows: [...picked], noun, companies, bySection };
}
