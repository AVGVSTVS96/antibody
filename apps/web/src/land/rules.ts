import type { BundleIndex } from "@antibody/core";
import { count, day } from "../lib/format.ts";
import type { BillModel, SectionView } from "../lib/model.ts";
import { money } from "./format.ts";

export type IndexBill = BundleIndex["bills"][number];
export type Stats = NonNullable<IndexBill["stats"]>;
export type Entry = IndexBill & { stats: Stats };

const byDate = (a: IndexBill, b: IndexBill) =>
  (b.latestActionOn ?? "").localeCompare(a.latestActionOn ?? "") || a.id.localeCompare(b.id);

/**
 * landing-order (docs/rules.md): bills the quiet-and-costly test could run on come first, then the most quiet and
 * costly sections, then the newest. The same for every bill; the first of the list is the featured bill.
 */
export function libraryOf(index: BundleIndex): Entry[] {
  return index.bills
    .filter((b): b is Entry => b.stats != null)
    .sort(
      (a, b) =>
        Number(b.stats.buriedTest.tested) - Number(a.stats.buriedTest.tested) ||
        b.stats.buried - a.stats.buried ||
        byDate(a, b),
    );
}

/**
 * landing-exhibit (docs/rules.md): of the featured bill's quiet and costly sections, the one most lobbying reports
 * name, then the one with the larger CBO figure, then the earlier one. None when the bill has no such section.
 */
export function exhibitOf(m: BillModel): SectionView | undefined {
  const size = (v: SectionView) => Math.abs(v.dollarsMusd ?? 0);
  return m.sections
    .filter((v) => v.s.inFinal && v.kind === "buried")
    .sort((a, b) => b.lobbied - a.lobbied || size(b) - size(a))[0];
}

const DAY = 86_400_000;

const isPassage = (v: BillModel["b"]["votes"][number]) =>
  /on passage/i.test(v.question) && /^(bill )?passed/i.test(v.result);

/** When a section first appeared, and for a late one how long after a chamber had passed the bill, with the records that say so. */
export function lineageOf(m: BillModel, v: SectionView): { text: string; claims: string[] } | null {
  const ver = m.versions.find((x) => x.code === v.s.firstVersion);
  if (!ver) return null;
  const when = ver.date ? ` of ${day(ver.date)}` : "";
  const claims = [ver.claim];
  if (!v.s.late) return { text: `First appeared in the “${ver.name}” text${when}.`, claims };
  const passed = ver.date
    ? m.b.votes.filter((x) => isPassage(x) && x.date < ver.date!).sort((a, b) => a.date.localeCompare(b.date))[0]
    : undefined;
  if (!passed || !ver.date)
    return { text: `First appeared in the “${ver.name}” text${when}, after a chamber had passed the bill.`, claims };
  const days = Math.round((Date.parse(ver.date) - Date.parse(passed.date)) / DAY);
  return {
    text: `First appeared in the “${ver.name}” text${when}, ${count(days, "day")} after the ${passed.chamber} passed the bill.`,
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
      lead: "Not tested.",
      mark: null,
      body: `${sentence(s.buriedTest.why ?? "The test could not run on this bill")}.`,
    };
  if (!s.buried) {
    const vote = s.tally && ` ${s.tally.chamber} vote ${s.tally.yeas} to ${s.tally.nays}.`;
    return {
      lead: "Nothing buried. We checked.",
      mark: null,
      body: `No section met the quiet-and-costly rule.${s.buriedTest.dollarsMeasured ? "" : " CBO gave no dollars per section, so only lobbying could show big stakes."}${vote ?? ""}`,
    };
  }
  const { addedMusd, cutMusd, measured } = s.quietCost;
  const cost = [addedMusd && `${money(addedMusd)} added`, cutMusd && `${money(cutMusd)} cut`]
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
    ? `CBO prices ${measured === s.buried ? "them" : `${measured} of the ${s.buried}`} at ${cost}.`
    : "CBO gave none of them a figure of its own.";
  return {
    lead: count(s.buried, "quiet section"),
    mark: measured ? `${money(addedMusd + cutMusd)} of change.` : null,
    body: `${name}: ${loud}${run}${priced}`,
  };
}
