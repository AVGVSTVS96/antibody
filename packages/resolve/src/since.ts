import { filled } from "@antibody/core";

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const CHANGE =
  /acqui[rs]|merged|merger|bought|purchas|wholly owned|owned by|owned since|subsidiary since|became a subsidiary|became part/iu;

const SAME_ENTITY = /renam|reorganiz|holding-company|holding company|spin-?off|redomicil/iu;
const WHEN = new RegExp(`\\b(?:(${MONTHS.join("|")})\\s+)?((?:19|20)\\d\\d)\\b`, "iu");

export function ownedSince(reason: string | null | undefined): string | null {
  if (!filled(reason) || !CHANGE.test(reason) || SAME_ENTITY.test(reason)) {
    return null;
  }

  const m = WHEN.exec(reason);

  if (!m) {
    return null;
  }

  const [, month, year] = m;

  if (filled(month)) {
    return `${year}-${String(MONTHS.indexOf(month.toLowerCase()) + 1).padStart(2, "0")}-01`;
  }

  return `${year}-12-31`;
}

export const ownedOn = (since: string | null, day: string | null | undefined): boolean =>
  !filled(since) || !filled(day) || day >= since;
