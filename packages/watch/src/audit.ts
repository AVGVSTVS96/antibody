import { readdir } from "node:fs/promises";
import { join } from "node:path";

export const AUDIT_DAYS = 14;

export interface MovedBill {
  bill: string;
  party: string;
  score: number;
  flagged: boolean;
}

export interface PartyRow {
  party: string;
  moved: number;
  flagged: number;
  rate: number;
  meanScore: number;
}

export interface PartyAudit {
  days: number;
  bills: number;
  parties: PartyRow[];
  /** Two-proportion z of the flag rate between the two biggest parties; null when either has no bills. */
  z: number | null;
  verdict: string;
}

/** A bill seen on several days counts once, at its highest score, flagged if any day flagged it. */
export function auditParties(days: MovedBill[][]): PartyAudit {
  const bills = new Map<string, MovedBill>();
  for (const m of days.flat()) {
    const prev = bills.get(m.bill);
    bills.set(m.bill, prev ? { ...prev, score: Math.max(prev.score, m.score), flagged: prev.flagged || m.flagged } : m);
  }
  const by = new Map<string, MovedBill[]>();
  for (const b of bills.values()) by.set(b.party, [...(by.get(b.party) ?? []), b]);
  const parties = [...by.entries()]
    .map(([party, bs]) => ({
      party,
      moved: bs.length,
      flagged: bs.filter((b) => b.flagged).length,
      rate: bs.filter((b) => b.flagged).length / bs.length,
      meanScore: Math.round((bs.reduce((s, b) => s + b.score, 0) / bs.length) * 10) / 10,
    }))
    .sort((a, b) => b.moved - a.moved || a.party.localeCompare(b.party));
  const [a, b] = parties
    .filter((p) => p.party === "R" || p.party === "D")
    .sort((x, y) => x.party.localeCompare(y.party));
  let z: number | null = null;
  if (a && b) {
    const pooled = (a.flagged + b.flagged) / (a.moved + b.moved);
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.moved + 1 / b.moved));
    z = se === 0 ? 0 : Math.round(((a.rate - b.rate) / se) * 100) / 100;
  }
  const verdict =
    z === null
      ? "Only one party's bills moved, so there is nothing to compare."
      : Math.abs(z) >= 2
        ? `The flag rates differ more than chance would explain (z = ${z}); check the rules for a party tilt before trusting this digest.`
        : `No flag-rate gap beyond chance (z = ${z}; |z| under 2).`;
  return { days: days.length, bills: bills.size, parties, z, verdict };
}

/** Moved-bill lists from the digests of the last AUDIT_DAYS days ending at `date`, today's included. */
export async function recentMoved(dir: string, date: string, today: MovedBill[]): Promise<MovedBill[][]> {
  const from = new Date(Date.parse(date) - (AUDIT_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  const files = (await readdir(dir).catch(() => [] as string[]))
    .map((f) => f.match(/^(\d{4}-\d{2}-\d{2})\.json$/)?.[1])
    .filter((d): d is string => !!d && d >= from && d < date);
  const out: MovedBill[][] = [];
  for (const d of files.sort()) {
    const j = (await Bun.file(join(dir, `${d}.json`)).json()) as { movedBills?: MovedBill[] };
    if (j.movedBills) out.push(j.movedBills);
  }
  return [...out, today];
}
