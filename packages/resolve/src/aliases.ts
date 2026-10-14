/**
 * Companies whose SEC filer is listed under a different name than the one lobbying filings and PACs use, checked by
 * hand against SEC's ticker list. The matcher and its model reviewer missed these (a one-word SEC name, or a holding
 * company that took over the listing), so a listed company's own lobbying was not tied to its stock.
 */
export const ALIASES: { names: string[]; cik: string; why: string }[] = [
  {
    names: ["EXXON MOBIL", "EXXONMOBIL"],
    cik: "2115436",
    why: "Exxon Mobil Corporation's shares are listed as XOM under ExxonMobil Holdings Corp (SEC CIK 2115436).",
  },
  {
    names: ["SEMPRA ENERGY"],
    cik: "1032208",
    why: "Sempra Energy is listed with the SEC as SEMPRA (SRE).",
  },
  {
    names: ["FRANKLIN RESOURCES"],
    cik: "38777",
    why: "Franklin Resources, Inc. is listed with the SEC as FRANKLIN TEMPLETON INC (BEN).",
  },
];

const BY_NAME = new Map(ALIASES.flatMap((a) => a.names.map((n) => [n, a] as const)));

export const aliasFor = (normalized: string) => BY_NAME.get(normalized);
