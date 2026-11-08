import { billDisplay, billId, billRef, CURRENT_CONGRESS } from "@antibody/core";
import type { BillId } from "@antibody/core";
import { billNames, billStatus, officialTitles } from "./billstatus.ts";
import type { BillStatus } from "./billstatus.ts";
import { billNumbers, clause, congressOf, nameForms } from "./extract.ts";
import type { Aliases, Matcher } from "./extract.ts";
import type { LdaFiling } from "./lda.ts";

const FIRST_BULK_CONGRESS = 113;
const firstYear = (congress: number) => 1789 + 2 * (congress - 1);

const lc = (s: string) => s.toLowerCase();

export async function buildAliases(bill: BillId, extra: BillId[] = [], signal?: AbortSignal): Promise<Aliases> {
  const own = await billStatus(bill, signal);

  if (!own) {
    throw new Error(`no BILLSTATUS for ${bill}`);
  }

  const statuses = [own];

  for (const id of extra) {
    const s = await billStatus(id, signal);

    if (s) {
      statuses.push(s);
    }
  }

  const { congress } = billRef(bill);

  const names = new Map<string, Aliases["names"][number]>();

  for (const s of statuses) {
    for (const n of billNames(s)) {
      const level = n.kind === "current" ? "high" : "medium";

      const why =
        n.kind === "current"
          ? `short title of ${billDisplay(s.id)}`
          : n.kind === "earlier"
            ? `an earlier title of ${billDisplay(s.id)}; other bills may have used it`
            : `title of a portion of ${billDisplay(s.id)}; another bill may share it`;

      for (const form of nameForms(n.title)) {
        const prev = names.get(lc(form));

        const since =
          [prev?.since, n.since].filter((d): d is string => d !== undefined && d !== null && d !== "").toSorted()[0] ??
          null;

        if (!prev || (prev.level === "medium" && level === "high")) {
          names.set(lc(form), { text: form, title: n.title, level, since, why });
        } else {
          prev.since = since;
        }
      }
    }
  }

  for (const [k, n] of names) {
    if ([...names.keys()].some((other) => other !== k && k.startsWith(other) && names.get(other)?.level === n.level)) {
      names.delete(k);
    }
  }

  const rivals = new Set<string>();

  for (const s of statuses) {
    const { congress: c, type, number } = billRef(s.id);

    for (let other = Math.max(FIRST_BULK_CONGRESS, c - 4); other <= Math.min(CURRENT_CONGRESS, c + 4); other++) {
      if (other === c) {
        continue;
      }

      const r = await billStatus(billId({ congress: other, type, number }), signal);

      if (!r) {
        continue;
      }

      for (const t of billNames(r)) {
        if (t.kind !== "portion") {
          for (const f of nameForms(t.title)) {
            if (!names.has(lc(f))) {
              rivals.add(f);
            }
          }
        }
      }

      for (const law of r.laws) {
        rivals.add(law);
      }
    }
  }

  const support = new Set<string>();

  for (const t of officialTitles(own)) {
    if (/\breconciliation\b/iu.test(t)) {
      support.add("reconciliation");
    }

    for (const n of billNumbers(t)) {
      if (n.type.endsWith("res")) {
        support.add(n.text.replaceAll(/\s+/gu, ""));
      }
    }
  }

  const introduced =
    statuses.flatMap((s) => (s.introduced === null || s.introduced === "" ? [] : [s.introduced])).toSorted()[0] ?? null;

  const start = introduced !== null && introduced !== "" ? Number(introduced.slice(0, 4)) : firstYear(congress);

  const end =
    own.enactedOn !== null && own.enactedOn !== "" ? Number(own.enactedOn.slice(0, 4)) + 1 : firstYear(congress) + 1;

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

export function coCited(filings: LdaFiling[], m: Matcher, min = 2): BillId[] {
  const counts = new Map<BillId, Set<string>>();

  for (const f of filings) {
    if (congressOf(f.filing_year) !== m.aliases.congress) {
      continue;
    }

    for (const a of f.lobbying_activities) {
      const text = a.description ?? "";
      const nums = billNumbers(text);

      for (const [i, n] of nums.entries()) {
        const id = billId({ congress: m.aliases.congress, type: n.type, number: n.number });

        if (m.numbers.has(`${n.type}${n.number}`)) {
          continue;
        }

        const prev = nums[i - 1];

        const c = clause(
          text,
          n.index,
          n.index + n.text.length,
          prev === undefined ? undefined : prev.index + prev.text.length,
          nums[i + 1]?.index,
        );

        if (!m.names.some((x) => !x.acronym && x.re.test(c))) {
          continue;
        }

        const filingIds = counts.get(id) ?? new Set<string>();
        filingIds.add(f.filing_uuid);
        counts.set(id, filingIds);
      }
    }
  }

  return [...counts].flatMap(([id, s]) => (s.size >= min ? [id] : []));
}

export function sameTitle(a: Aliases, candidate: BillStatus): boolean {
  const ours = new Set(a.names.filter((n) => n.level === "high").map((n) => lc(n.text)));

  return billNames(candidate).some((t) => t.kind !== "portion" && nameForms(t.title).some((f) => ours.has(lc(f))));
}
