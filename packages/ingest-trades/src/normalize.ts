import type { Row } from "@antibody/core";

export type Owner = Row<"trades">["owner"];
export type TradeType = Row<"trades">["type"];

const OWNERS: Record<string, Owner> = {
  "": "self",
  self: "self",
  sp: "spouse",
  s: "spouse",
  j: "joint",
  spouse: "spouse",
  jt: "joint",
  joint: "joint",
  dc: "dependent",
  child: "dependent",
  dependent: "dependent",
  "dependent child": "dependent",
};

/**
 * House codes (blank/SP/JT/DC), the Senate paper form's (S)/(J)/(DC), Senate eFD words (Self/Spouse/Joint/Child)
 * and vision output map to one owner. A blank owner cell means the filer, per both forms' instructions.
 */
export function owner(raw: string | null | undefined): Owner | null {
  return (
    OWNERS[
      (raw ?? "")
        .trim()
        .toLowerCase()
        .replace(/^\((.*)\)$/, "$1")
    ] ?? null
  );
}

export function tradeType(raw: string): TradeType | null {
  const t = raw.trim().toLowerCase();
  if (/partial/.test(t)) return "sale_partial";
  if (/^(s\b|sale)/.test(t)) return "sale";
  if (/^(p\b|purchase)/.test(t)) return "purchase";
  if (/^(e\b|exchange)/.test(t)) return "exchange";
  return null;
}

/** MM/DD/YYYY (or M/D/YY, or with dashes) to ISO, only when it is a real calendar date; anything else stays as filed and gives null. */
export function isoDate(raw: string | null | undefined): string | null {
  const m = (raw ?? "").trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (!m) return null;
  const [, mm = "", dd = "", yy = ""] = m;
  const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
  const d = new Date(Date.UTC(year, Number(mm) - 1, Number(dd)));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== Number(mm) - 1 || d.getUTCDate() !== Number(dd)) return null;
  return d.toISOString().slice(0, 10);
}

const dollars = (s: string) => Number(s.replace(/[$,\s]/g, ""));

/** The statutory value ranges, by upper bound; a printed lower bound that disagrees ("$1,000", "$1,0001") is a form variant or typo for the bucket's real floor. */
const BUCKET_FLOOR = new Map([
  [15000, 1001],
  [50000, 15001],
  [100000, 50001],
  [250000, 100001],
  [500000, 250001],
  [1000000, 500001],
  [5000000, 1000001],
  [25000000, 5000001],
  [50000000, 25000001],
]);

/** Disclosure ranges ("$1,001 - $15,000", "Over $50,000,000", "Spouse/DC Over $1,000,000") or an exact amount as filed. */
export function amountRange(raw: string): { min: number | null; max: number | null } {
  const s = raw
    .replace(/[\u00ad\u2010-\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const range = s.match(/\$\s?([\d,]+(?:\.\d+)?)\s?-+\s?\$\s?([\d,]+(?:\.\d+)?)/);
  if (range) {
    const max = dollars(range[2]!);
    return { min: BUCKET_FLOOR.get(max) ?? dollars(range[1]!), max };
  }
  const over = s.match(/over \$\s?([\d,]+)/i);
  if (over) return { min: dollars(over[1]!) + 1, max: null };
  const exact = s.match(/^\$\s?([\d,]*(?:\.\d+)?)$/);
  if (exact?.[1]) return { min: dollars(exact[1]), max: dollars(exact[1]) };
  return { min: null, max: null };
}
