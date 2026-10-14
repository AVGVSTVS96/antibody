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
  /acqui[rs]|merged|merger|bought|purchas|wholly owned|owned by|owned since|subsidiary since|became a subsidiary|became part/i;
const SAME_ENTITY = /renam|reorganiz|holding-company|holding company|spin-?off|redomicil/i;
const WHEN = new RegExp(`\\b(?:(${MONTHS.join("|")})\\s+)?((?:19|20)\\d\\d)\\b`, "i");

/**
 * The day a subsidiary came under its parent, read from the reviewer's reason ("Denbury was acquired by ExxonMobil in
 * November 2023"). Null when the reason gives no year, or the change was a rename or reorganization of one company.
 * A year with no month counts from the end of that year, so a filing in the year of the deal is not tied through it.
 */
export function ownedSince(reason: string | null | undefined): string | null {
  if (!reason || !CHANGE.test(reason) || SAME_ENTITY.test(reason)) return null;
  const m = WHEN.exec(reason);
  if (!m) return null;
  const year = Number(m[2]);
  if (m[1]) return `${year}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, "0")}-01`;
  return `${year}-12-31`;
}

/** Whether a filing or gift on `day` falls while the subsidiary was owned. */
export const ownedOn = (since: string | null, day: string | null | undefined): boolean =>
  !since || !day || day >= since;
