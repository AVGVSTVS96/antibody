import type { Row } from "@antibody/core";

export type Owner = Row<"trades">["owner"];

export type TradeType = Row<"trades">["type"];

const OWNERS = new Map<string, Owner>(
  Object.entries({
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
  }),
);

export function owner(raw: string | null | undefined): Owner | null {
  return (
    OWNERS.get(
      (raw ?? "")
        .trim()
        .toLowerCase()
        .replace(/^\((.*)\)$/u, "$1"),
    ) ?? null
  );
}

export function tradeType(raw: string): TradeType | null {
  const t = raw.trim().toLowerCase();

  if (t.includes("partial")) {
    return "sale_partial";
  }

  if (/^(s\b|sale)/u.test(t)) {
    return "sale";
  }

  if (/^(p\b|purchase)/u.test(t)) {
    return "purchase";
  }

  if (/^(e\b|exchange)/u.test(t)) {
    return "exchange";
  }

  return null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function isoDate(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  const num = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/u.exec(s);
  const word = /^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[\s,.-]*(\d{2}|\d{4})$/u.exec(s);

  const month = MONTHS.indexOf(word?.[2]?.toLowerCase() ?? "") + 1;

  const [mm, dd, yy] = num
    ? [Number(num[1]), Number(num[2]), num[3] ?? ""]
    : word && month > 0
      ? [month, Number(word[1]), word[3] ?? ""]
      : [0, 0, ""];

  if (!mm || !dd || yy === "") {
    return null;
  }

  const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
  const d = new Date(Date.UTC(year, mm - 1, dd));

  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) {
    return null;
  }

  return d.toISOString().slice(0, 10);
}

const dollars = (s: string) => Number(s.replaceAll(/[$,\s]/gu, ""));

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

interface AmountRange {
  min: number | null;
  max: number | null;
}

export function amountRange(raw: string): AmountRange {
  const s = raw
    .replaceAll(/[\u00AD\u2010-\u2014]/gu, "-")
    .replaceAll(/\s+/gu, " ")
    .trim();

  const range = /\$\s?([\d,]+(?:\.\d+)?)\s?-+\s?\$\s?([\d,]+(?:\.\d+)?)/u.exec(s);

  if (range) {
    const max = dollars(range[2] ?? "");

    return { min: BUCKET_FLOOR.get(max) ?? dollars(range[1] ?? ""), max };
  }

  const over = /over \$\s?([\d,]+)/iu.exec(s);

  if (over) {
    return { min: dollars(over[1] ?? "") + 1, max: null };
  }

  const exact = /^\$\s?([\d,]*(?:\.\d+)?)$/u.exec(s);

  const amount = exact?.[1];

  if (amount !== undefined && amount !== "") {
    return { min: dollars(amount), max: dollars(amount) };
  }

  return { min: null, max: null };
}
