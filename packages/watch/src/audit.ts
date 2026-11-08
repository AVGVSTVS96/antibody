import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const AUDIT_DAYS = 14;
const MIN_FLAGGED = 10;

export interface MovedBill {
  bill: string;
  party: string;
  score: number;
  flagged: boolean;
}

const DigestMoved = z.object({
  movedBills: z
    .array(z.object({ bill: z.string(), party: z.string(), score: z.number(), flagged: z.boolean() }))
    .optional(),
});

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
  z: number | null;
  verdict: string;
}

export function auditParties(days: MovedBill[][]): PartyAudit {
  const bills = new Map<string, MovedBill>();

  for (const m of days.flat()) {
    const prev = bills.get(m.bill);
    bills.set(m.bill, prev ? { ...prev, score: Math.max(prev.score, m.score), flagged: prev.flagged || m.flagged } : m);
  }

  const by = new Map<string, MovedBill[]>();

  for (const b of bills.values()) {
    by.set(b.party, [...(by.get(b.party) ?? []), b]);
  }

  const parties = [...by.entries()]
    .map(([party, bs]) => ({
      party,
      moved: bs.length,
      flagged: bs.filter((b) => b.flagged).length,
      rate: bs.filter((b) => b.flagged).length / bs.length,
      meanScore: Math.round((bs.reduce((s, b) => s + b.score, 0) / bs.length) * 10) / 10,
    }))
    .toSorted((a, b) => b.moved - a.moved || a.party.localeCompare(b.party));

  const [a, b] = parties
    .filter((p) => p.party === "R" || p.party === "D")
    .toSorted((x, y) => x.party.localeCompare(y.party));

  let zScore: number | null = null;

  if (a && b) {
    const pooled = (a.flagged + b.flagged) / (a.moved + b.moved);
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.moved + 1 / b.moved));
    zScore = se === 0 ? 0 : Math.round(((a.rate - b.rate) / se) * 100) / 100;
  }

  const flagged = parties.reduce((n, p) => n + p.flagged, 0);

  const verdict =
    flagged < MIN_FLAGGED
      ? `Only ${flagged} bills were flagged, too few to test for a gap; the rates are shown for the record.`
      : zScore === null
        ? "Only one party's bills moved, so there is nothing to compare."
        : Math.abs(zScore) >= 2
          ? `The flag rates differ more than chance would explain (z = ${zScore}); check the rules for a party tilt before trusting this digest.`
          : `No flag-rate gap beyond chance (z = ${zScore}; |z| under 2).`;

  return { days: days.length, bills: bills.size, parties, z: zScore, verdict };
}

export async function recentMoved(dir: string, date: string, today: MovedBill[]): Promise<MovedBill[][]> {
  const from = new Date(Date.parse(date) - (AUDIT_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);

  const names = await readdir(dir).catch((): string[] => []);

  const files = names.flatMap((f) => {
    const d = /^(\d{4}-\d{2}-\d{2})\.json$/u.exec(f)?.[1];

    return d !== undefined && d >= from && d < date ? [d] : [];
  });

  const out: MovedBill[][] = [];

  for (const d of files.toSorted()) {
    const { movedBills } = DigestMoved.parse(await Bun.file(join(dir, `${d}.json`)).json());

    if (movedBills) {
      out.push(movedBills);
    }
  }

  return [...out, today];
}
