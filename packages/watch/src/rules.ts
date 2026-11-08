import type { BillStatus } from "./billstatus.ts";

const RIDER_KIND_NAMES = ["clock", "engross", "deem", "table", "discharge", "amend"] as const;

export type RiderKind = (typeof RIDER_KIND_NAMES)[number];

export const RIDER_KINDS = {
  clock: {
    label: "Stops the clock on a law that lets members force a vote",
    re: /shall not constitute a calendar day|section 202 of the National Emergencies Act[\s\S]{0,160}?shall not apply/iu,
  },
  engross: {
    label: "Has the Clerk add another bill's text into a bill after the House votes",
    re: /In the engrossment of[\s\S]{0,400}?the Clerk shall[\s\S]{0,80}?add the text of/iu,
  },
  deem: {
    label: "Counts a measure as passed, adopted or agreed to without its own vote",
    re: /shall be considered to have (?:taken|concurred|agreed|passed|adopted)|\bis hereby adopted\b|shall be considered as (?:passed|agreed to) by the House/iu,
  },
  table: {
    label: "Kills another resolution by laying it on the table without its own vote",
    re: /(?:House Resolution|H\. ?Res\.) \d+(?:,? and (?:House Resolution|H\. ?Res\.) \d+)? (?:is|are) (?:hereby )?laid on the table/iu,
  },
  discharge: {
    label: "Blocks discharge petitions on a subject",
    re: /motion to discharge[^.]{0,400}shall not be in order/iu,
  },
  amend: {
    label: "Changes or cancels an earlier rule",
    re: /(?:Section \d+ of )?House Resolution \d+[^.]{0,80}(?:is amended|shall have no force or effect)/iu,
  },
} as const satisfies Record<RiderKind, { label: string; re: RegExp }>;

export interface Rider {
  kind: RiderKind;
  label: string;
  section: string;
  quote: string;
}

export const isSpecialRule = (s: Pick<BillStatus, "id" | "title">) =>
  s.id.split("-")[1] === "hres" &&
  /^(?:Providing for|Relating to|Waiving)\b[^.]*\b(?:consideration|disposition|adoption|requirement)/iu.test(s.title);

const strip = (s: string) =>
  s
    .replaceAll(/<[^>]+>/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .replaceAll(/\s+([.,;)])/gu, "$1")
    .trim();

function sentence(text: string, index: number, length: number): string {
  const dot = text.lastIndexOf(". ", index);
  const from = dot === -1 ? 0 : dot + 2;
  const start = Math.max(from, index - 150);
  const stop = text.indexOf(". ", index + length);
  const to = stop === -1 ? text.length : stop + 1;
  const end = Math.min(to, index + length + 150);

  return `${start > from ? "…" : ""}${text.slice(start, end).trim()}${end < to ? "…" : ""}`;
}

export function ruleRiders(xml: string): Rider[] {
  const out: Rider[] = [];
  const sections = [...xml.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/gu)].map(([, body = ""]) => body);
  sections.forEach((body, i) => {
    const num = /<enum>\s*([^<]*?)\.?\s*<\/enum>/u.exec(body)?.[1] ?? String(i + 1);
    const text = strip(body);

    for (const kind of RIDER_KIND_NAMES) {
      const { label, re } = RIDER_KINDS[kind];
      const m = re.exec(text);

      if (m) {
        out.push({ kind, label, section: num, quote: sentence(text, m.index, m[0].length) });
      }
    }
  });

  return out;
}
