import type { BundleIndex } from "@antibody/core";
import { day } from "../lib/format.ts";

type Entry = BundleIndex["bills"][number];
type Pick = BundleIndex["watch"][number];

export const partyWord = (p: "R" | "D" | "I") => ({ R: "Republican", D: "Democratic", I: "Independent" })[p];

export function signedLine(b: Entry) {
  const when = b.latestActionOn ? day(b.latestActionOn) : null;
  const status = b.law ? `signed ${when}` : when ? `last action ${when}` : "in Congress";
  return `${b.display}, ${status}${b.sponsorParty ? `. ${partyWord(b.sponsorParty)} sponsor` : ""}`;
}

/** The watcher's reason, split into its clauses: the first is the label, the rest read as sentences. */
export function picksNote(w: Pick): string[] {
  const parts = (w.reason ?? "").split(/;\s+/).filter(Boolean);
  if (!parts.length) return ["Moved this week"];
  return parts.map((p, i) =>
    i === 0
      ? p.replace(/^(.)/, (c) => c.toUpperCase())
      : `${p.replace(/^(.)/, (c) => c.toUpperCase())}${/[.!?]$/.test(p) ? "" : "."}`,
  );
}
