import type { Featured } from "@antibody/core";
import { assemble, placeOf, type Tape, type TapeMark } from "../lib/tape.ts";

/** The featured bill's tape from its index block: the same rows `buildTape` makes from the whole bundle. */
export function tapeOfFeatured(f: Featured): Tape<TapeMark> {
  const rows = f.rows.map(
    (r, index): TapeMark => ({
      index,
      id: r.id,
      routeId: r.slug,
      num: r.num,
      label: `§${r.num}`,
      heading: r.heading,
      kind: r.kind,
      musd: r.musd,
      evenSplit: r.evenSplit,
      late: r.late,
      ...placeOf(r.path),
      articles: r.articles,
      lobbying: r.named,
    }),
  );
  return assemble(rows, { lateKnown: f.lateReason == null, lateReason: f.lateReason, read: f.read });
}

/** The featured bill's claims live in shards, so its chips need only the manifest, not the bundle. */
export const sourceOf = (f: Featured) => ({
  claims: {},
  claimShards: f.claimShards,
  rules: f.rules,
  bill: { id: f.billId },
});
