export type Bill = { key: string; name: string; congress: number; years: number[]; search: string[]; extra?: string[] };

export const bills: Bill[] = [
  {
    key: "genius",
    name: "GENIUS Act (S.1582, 119th; earlier S.394, S.919)",
    congress: 119,
    years: [2025, 2026],
    search: ['"GENIUS Act"', '"S. 1582"', '"S.1582"', '"S. 394"', '"S.394"', '"S1582"', '"S. 919"', '"S.919"', '"National Innovation for U.S. Stablecoins"', '"119-27"'],
    extra: ['"GENUIS"'],
  },
  {
    key: "obbba",
    name: "One Big Beautiful Bill Act (H.R.1, 119th, P.L. 119-21)",
    congress: 119,
    years: [2025, 2026],
    search: ['"One Big Beautiful Bill"', '"H.R. 1"', '"H.R.1"', '"HR 1"', '"HR1"', '"H. R. 1"', '"OBBBA"', '"OBBB"', '"119-21"'],
    extra: ['"Big Beautiful Bill" -"One Big Beautiful Bill"', '"Beautiful Bill" -"Big Beautiful Bill"', '"OBBA"'],
  },
  {
    key: "ira",
    name: "Inflation Reduction Act (H.R.5376, 117th, P.L. 117-169)",
    congress: 117,
    years: [2021, 2022],
    search: ['"Inflation Reduction Act"', '"H.R. 5376"', '"H.R.5376"', '"HR 5376"', '"HR5376"', '"H. R. 5376"', '"Build Back Better"', '"117-169"'],
  },
];
