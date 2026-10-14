import type { BundleIndex, Featured } from "@antibody/core";
import { count, day } from "../lib/format.ts";
import { extraDigits } from "../lib/sums.ts";
import { money, moneyPrinter, shownMoney } from "./format.ts";

export type IndexBill = BundleIndex["bills"][number];
export type Stats = NonNullable<IndexBill["stats"]>;
export type Entry = IndexBill & { stats: Stats };

const DAY = 86_400_000;

/** When the exhibit's section first appeared, and for a late one how long after a chamber had passed the bill, with the records that say so. */
export function lineageOf({ exhibit, rows }: Featured): { text: string; claims: string[] } | null {
  const first = exhibit?.firstText;
  if (!exhibit || !first) return null;
  const when = first.date ? ` of ${day(first.date)}` : "";
  const claims = [first.claim];
  if (!rows[exhibit.row]!.late) return { text: `First appeared in the “${first.name}” text${when}.`, claims };
  const { passed } = exhibit;
  if (!passed || !first.date)
    return { text: `First appeared in the “${first.name}” text${when}, after a chamber had passed the bill.`, claims };
  const days = Math.round((Date.parse(first.date) - Date.parse(passed.date)) / DAY);
  return {
    text: `First appeared in the “${first.name}” text${when}, ${count(days, "day")} after the ${passed.chamber} passed the bill.`,
    claims: [...claims, passed.claim],
  };
}

export interface Story {
  lead: string;
  mark: string | null;
  body: string;
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One headline and paragraph from a bill's index stats, by the same template for every bill. */
export function storyOf(b: Entry): Story {
  const s = b.stats;
  const name = b.shortTitle ?? b.title;
  if (!s.buriedTest.tested)
    return {
      lead: "We couldn't test this bill for quiet sections.",
      mark: null,
      body: `${sentence(s.buriedTest.why ?? "The test could not run on this bill")}.`,
    };
  if (!s.buried) {
    const vote = s.tally && ` ${s.tally.chamber} vote ${s.tally.yeas} to ${s.tally.nays}.`;
    return {
      lead: `${count(s.sections, "section")}, none quiet and costly.`,
      mark: null,
      body: `No section met the quiet-and-costly rule.${s.buriedTest.dollarsMeasured ? "" : " CBO gave no dollars per section, so only lobbying could show big stakes."}${vote ?? ""}`,
    };
  }
  const { addedMusd, cutMusd, measured } = s.quietCost;
  const more = extraDigits(moneyPrinter, (v, eq) => eq(v(addedMusd) + v(cutMusd), addedMusd + cutMusd));
  const cost = [addedMusd && `${money(addedMusd, more)} added`, cutMusd && `${money(cutMusd, more)} cut`]
    .filter(Boolean)
    .join(" and ");
  const loud =
    s.mentions && s.articlesRead
      ? `${count(s.headline, "loud section")} took ${s.mentions.headline} of ${s.mentions.total} mentions in the ${s.articlesRead} articles we read. `
      : "";
  const run = s.quietRun
    ? `${s.quietRun.marks} quiet and costly sections in one run drew ${s.quietRun.hits ? count(s.quietRun.hits, "mention") : "none"}. `
    : "";
  const priced = measured
    ? `CBO prices ${measured === s.buried ? `the ${s.buried}` : `${measured} of the ${s.buried}`} at ${cost}.`
    : "CBO gave none of them a figure of its own.";
  return {
    lead: count(s.buried, "quiet section"),
    mark: measured ? `${shownMoney(more, addedMusd, cutMusd)} of change.` : null,
    body: `${name}: ${loud}${run}${priced}`,
  };
}
