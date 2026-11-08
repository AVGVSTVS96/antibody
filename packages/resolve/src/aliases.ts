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
