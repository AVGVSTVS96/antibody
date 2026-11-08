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

  if (t.includes("partial")) {
    return "sale_partial";
  }

  if (/^(s\b|sale)/.test(t)) {
    return "sale";
  }

  if (/^(p\b|purchase)/.test(t)) {
    return "purchase";
  }

  if (/^(e\b|exchange)/.test(t)) {
    return "exchange";
  }

  return null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** MM/DD/YYYY (or M/D/YY, with dashes, or D-Mon-YY) to ISO, only when it is a real calendar date; anything else stays as filed and gives null. */
export function isoDate(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  const num = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(s);
  const word = /^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[\s,.-]*(\d{2}|\d{4})$/.exec(s);

  const [mm, dd, yy] = num
    ? [Number(num[1]), Number(num[2]), num[3]!]
    : word && MONTHS.includes(word[2]!.toLowerCase())
      ? [MONTHS.indexOf(word[2]!.toLowerCase()) + 1, Number(word[1]), word[3]!]
      : [];

  if (!mm || !dd || !yy) {
    return null;
  }

  const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
  const d = new Date(Date.UTC(year, mm - 1, dd));

  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) {
    return null;
  }

  return d.toISOString().slice(0, 10);
}

const dollars = (s: string) => Number(s.replaceAll(/[$,\s]/g, ""));

/** The statutory value ranges, by upper bound; a printed lower bound that disagrees ("$1,000", "$1,0001") is a form variant or typo for the bucket's real floor. */
const BUCKET_FLOOR = new Map([
  [15_000, 1001],
  [50_000, 15_001],
  [100_000, 50_001],
  [250_000, 100_001],
  [500_000, 250_001],
  [1_000_000, 500_001],
  [5_000_000, 1_000_001],
  [25_000_000, 5_000_001],
  [50_000_000, 25_000_001],
]);

/** Disclosure ranges ("$1,001 - $15,000", "Over $50,000,000", "Spouse/DC Over $1,000,000") or an exact amount as filed. */
export function amountRange(raw: string): { min: number | null; max: number | null } {
  const s = raw
    .replaceAll(/[\u00AD\u2010-\u2014]/g, "-")
    .replaceAll(/\s+/g, " ")
    .trim();

  const range = /\$\s?([\d,]+(?:\.\d+)?)\s?-+\s?\$\s?([\d,]+(?:\.\d+)?)/.exec(s);

  if (range) {
    const max = dollars(range[2]!);

    return { min: BUCKET_FLOOR.get(max) ?? dollars(range[1]!), max };
  }

  const over = /over \$\s?([\d,]+)/i.exec(s);

  if (over) {
    return { min: dollars(over[1]!) + 1, max: null };
  }

  const exact = /^\$\s?([\d,]*(?:\.\d+)?)$/.exec(s);

  if (exact?.[1]) {
    return { min: dollars(exact[1]), max: dollars(exact[1]) };
  }

  return { min: null, max: null };
}
