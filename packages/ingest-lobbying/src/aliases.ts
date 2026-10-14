import { type BillId, billDisplay, billId, billRef, CURRENT_CONGRESS } from "@antibody/core";
import { type BillStatus, billNames, billStatus, officialTitles } from "./billstatus.ts";
import { type Aliases, billNumbers, clause, congressOf, type Matcher, nameForms } from "./extract.ts";
import type { LdaFiling } from "./lda.ts";

/** GovInfo bulk BILLSTATUS starts with the 113th Congress. */
const FIRST_BULK_CONGRESS = 113;
const firstYear = (congress: number) => 1789 + 2 * (congress - 1);

const lc = (s: string) => s.toLowerCase();

/**
 * Builds the bill's aliases from public records only: its BILLSTATUS titles and law number, the bills in `extra`
 * (earlier numbers confirmed to carry the same short title), and the titles of bills that reused one of its numbers
 * in nearby Congresses, which mark a clause as being about something else.
 */
export async function buildAliases(bill: BillId, extra: BillId[] = [], signal?: AbortSignal): Promise<Aliases> {
  const own = await billStatus(bill, signal);
  if (!own) throw new Error(`no BILLSTATUS for ${bill}`);
  const statuses = [own];
  for (const id of extra) {
    const s = await billStatus(id, signal);
    if (s) statuses.push(s);
  }
  const { congress } = billRef(bill);

  const names = new Map<string, Aliases["names"][number]>();
  for (const s of statuses) {
    const { whole, portions } = billNames(s);
    const add = (title: string, level: "high" | "medium", why: string) => {
      for (const form of nameForms(title)) {
        const prev = names.get(lc(form));
        const since = [prev?.since, s.introduced].filter((d): d is string => !!d).sort()[0] ?? null;
        if (!prev || (prev.level === "medium" && level === "high"))
          names.set(lc(form), { text: form, title, level, since, why });
        else prev.since = since;
      }
    };
    for (const t of whole) add(t, "high", `short title of ${billDisplay(s.id)}`);
    for (const t of portions) add(t, "medium", `title of a portion of ${billDisplay(s.id)}; another bill may share it`);
  }
  for (const [k, n] of names)
    if ([...names.keys()].some((other) => other !== k && k.startsWith(other) && names.get(other)!.level === n.level))
      names.delete(k);

  const rivals = new Set<string>();
  for (const s of statuses) {
    const { congress: c, type, number } = billRef(s.id);
    for (let other = Math.max(FIRST_BULK_CONGRESS, c - 4); other <= Math.min(CURRENT_CONGRESS, c + 4); other++) {
      if (other === c) continue;
      const r = await billStatus(billId({ congress: other, type, number }), signal);
      if (!r) continue;
      for (const t of billNames(r).whole) for (const f of nameForms(t)) if (!names.has(lc(f))) rivals.add(f);
      for (const law of r.laws) rivals.add(law);
    }
  }

  const support = new Set<string>();
  for (const t of officialTitles(own)) {
    if (/\breconciliation\b/i.test(t)) support.add("reconciliation");
    for (const n of billNumbers(t)) if (n.type.endsWith("res")) support.add(n.text.replace(/\s+/g, ""));
  }

  const introduced =
    statuses
      .map((s) => s.introduced)
      .filter((d): d is string => !!d)
      .sort()[0] ?? null;
  const start = introduced ? Number(introduced.slice(0, 4)) : firstYear(congress);
  const end = own.enactedOn ? Number(own.enactedOn.slice(0, 4)) + 1 : firstYear(congress) + 1;
  const thisYear = new Date().getUTCFullYear();
  const years = Array.from({ length: Math.max(0, Math.min(end, thisYear) - start + 1) }, (_, i) => start + i);

  return {
    bill,
    congress,
    numbers: statuses.map((s, i) => ({
      id: s.id,
      introduced: s.introduced,
      why: i === 0 ? "the bill's own number" : `carries the same short title (${s.url})`,
    })),
    names: [...names.values()],
    laws: [...new Set(statuses.flatMap((s) => (s.id === bill ? s.laws : [])))],
    introduced,
    enactedOn: own.enactedOn,
    rivals: [...rivals],
    support: [...support],
    years,
  };
}

/**
 * Bill numbers that filings cite in the same clause as the bill's name, in its Congress, by at least `min`
 * filings: candidates for earlier versions under another number (S.394 → S.1582).
 */
export function coCited(filings: LdaFiling[], m: Matcher, min = 2): BillId[] {
  const counts = new Map<BillId, Set<string>>();
  for (const f of filings) {
    if (congressOf(f.filing_year) !== m.aliases.congress) continue;
    for (const a of f.lobbying_activities) {
      const text = a.description ?? "";
      const nums = billNumbers(text);
      for (const [i, n] of nums.entries()) {
        const id = billId({ congress: m.aliases.congress, type: n.type, number: n.number });
        if (m.numbers.has(`${n.type}${n.number}`)) continue;
        const prev = nums[i - 1];
        const c = clause(
          text,
          n.index,
          n.index + n.text.length,
          prev && prev.index + prev.text.length,
          nums[i + 1]?.index,
        );
        if (!m.names.some((x) => !x.acronym && x.re.test(c))) continue;
        if (!counts.has(id)) counts.set(id, new Set());
        counts.get(id)!.add(f.filing_uuid);
      }
    }
  }
  return [...counts].filter(([, s]) => s.size >= min).map(([id]) => id);
}

/** A candidate is an alias only when its own BILLSTATUS carries one of the bill's whole-bill short titles. */
export function sameTitle(a: Aliases, candidate: BillStatus): boolean {
  const ours = new Set(a.names.filter((n) => n.level === "high").map((n) => lc(n.text)));
  return billNames(candidate).whole.some((t) => nameForms(t).some((f) => ours.has(lc(f))));
}
