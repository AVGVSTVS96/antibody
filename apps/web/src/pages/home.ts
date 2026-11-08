import type { BundleIndex } from "@antibody/core";
import { day } from "../lib/format.ts";

type Entry = BundleIndex["bills"][number];

type Pick = BundleIndex["watch"][number];

export const partyWord = (p: "R" | "D" | "I") => ({ R: "Republican", D: "Democratic", I: "Independent" })[p];

export function signedLine(b: Entry) {
  const when = b.latestActionOn === null ? null : day(b.latestActionOn);
  const isLaw = (b.law ?? "") !== "";
  const status = isLaw ? `signed ${when}` : when === null ? "in Congress" : `last action ${when}`;

  return `${b.display}, ${status}${b.sponsorParty === null ? "" : `. ${partyWord(b.sponsorParty)} sponsor`}`;
}

export function picksNote(w: Pick): string[] {
  const parts = (w.reason ?? "").split(/;\s+/u).filter(Boolean);

  if (!parts.length) {
    return ["Moved this week"];
  }

  return parts.map((p, i) =>
    i === 0
      ? p.replace(/^(.)/u, (c) => c.toUpperCase())
      : `${p.replace(/^(.)/u, (c) => c.toUpperCase())}${/[.!?]$/u.test(p) ? "" : "."}`,
  );
}
