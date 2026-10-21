import type { BillStatus } from "./billstatus.ts";

/**
 * A House rule (a special order, H.Res.) sets up debate on other measures. These are the kinds of sections that do
 * more than that, each found by its wording in the rule's text. Same patterns for every rule and party.
 */
export const RIDER_KINDS = {
  clock: {
    label: "Stops the clock on a law that lets members force a vote",
    re: /shall not constitute a calendar day|section 202 of the National Emergencies Act[\s\S]{0,160}?shall not apply/i,
  },
  engross: {
    label: "Has the Clerk add another bill's text into a bill after the House votes",
    re: /In the engrossment of[\s\S]{0,400}?the Clerk shall[\s\S]{0,80}?add the text of/i,
  },
  deem: {
    label: "Counts a measure as passed, adopted or agreed to without its own vote",
    re: /shall be considered to have (?:taken|concurred|agreed|passed|adopted)|\bis hereby adopted\b|shall be considered as (?:passed|agreed to) by the House/i,
  },
  table: {
    label: "Kills another resolution by laying it on the table without its own vote",
    re: /(?:House Resolution|H\. ?Res\.) \d+(?:,? and (?:House Resolution|H\. ?Res\.) \d+)? (?:is|are) (?:hereby )?laid on the table/i,
  },
  discharge: {
    label: "Blocks discharge petitions on a subject",
    re: /motion to discharge[^.]{0,400}shall not be in order/i,
  },
  amend: {
    label: "Changes or cancels an earlier rule",
    re: /(?:Section \d+ of )?House Resolution \d+[^.]{0,80}(?:is amended|shall have no force or effect)/i,
  },
} as const;
export type RiderKind = keyof typeof RIDER_KINDS;

export interface Rider {
  kind: RiderKind;
  label: string;
  /** The rule's section number ("1" for the undesignated first section). */
  section: string;
  /** The sentence that matched, trimmed. */
  quote: string;
}

/** A special order: a House resolution that brings other measures to the floor. */
export const isSpecialRule = (s: Pick<BillStatus, "id" | "title">) =>
  s.id.split("-")[1] === "hres" &&
  /^(?:Providing for|Relating to|Waiving)\b[^.]*\b(?:consideration|disposition|adoption|requirement)/i.test(s.title);

const strip = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;)])/g, "$1")
    .trim();

/** The sentence around a match, cut to about 150 characters either side. */
function sentence(text: string, index: number, length: number): string {
  const dot = text.lastIndexOf(". ", index);
  const from = dot < 0 ? 0 : dot + 2;
  const start = Math.max(from, index - 150);
  const stop = text.indexOf(". ", index + length);
  const to = stop < 0 ? text.length : stop + 1;
  const end = Math.min(to, index + length + 150);
  return `${start > from ? "…" : ""}${text.slice(start, end).trim()}${end < to ? "…" : ""}`;
}

/** Sections of a rule's text (GovInfo bill XML) that do more than set up debate. */
export function ruleRiders(xml: string): Rider[] {
  const out: Rider[] = [];
  const sections = [...xml.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/g)].map((m) => m[1]!);
  sections.forEach((body, i) => {
    const num = body.match(/<enum>\s*([^<]*?)\.?\s*<\/enum>/)?.[1] ?? String(i + 1);
    const text = strip(body);
    for (const [kind, { label, re }] of Object.entries(RIDER_KINDS) as [RiderKind, (typeof RIDER_KINDS)[RiderKind]][]) {
      const m = text.match(re);
      if (m) out.push({ kind, label, section: num, quote: sentence(text, m.index!, m[0].length) });
    }
  });
  return out;
}
