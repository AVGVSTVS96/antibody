export const CURRENT_CONGRESS = 119;

export const BILL_TYPES = ["hr", "s", "hjres", "sjres", "hconres", "sconres", "hres", "sres"] as const;

export type BillType = (typeof BILL_TYPES)[number];

export type BillId = `${number}-${BillType}-${number}`;

const DISPLAY: Record<BillType, string> = {
  hr: "H.R.",
  s: "S.",
  hjres: "H.J.Res.",
  sjres: "S.J.Res.",
  hconres: "H.Con.Res.",
  sconres: "S.Con.Res.",
  hres: "H.Res.",
  sres: "S.Res.",
};

const CONGRESS_GOV_TYPE: Record<BillType, string> = {
  hr: "house-bill",
  s: "senate-bill",
  hjres: "house-joint-resolution",
  sjres: "senate-joint-resolution",
  hconres: "house-concurrent-resolution",
  sconres: "senate-concurrent-resolution",
  hres: "house-resolution",
  sres: "senate-resolution",
};

export interface BillRef {
  congress: number;
  type: BillType;
  number: number;
}

const fromCongressGovType = new Map(BILL_TYPES.map((t) => [CONGRESS_GOV_TYPE[t], t]));

const isBillType = (t: string): t is BillType => BILL_TYPES.some((b) => b === t);

export function parseBillId(input: string, congress = CURRENT_CONGRESS): BillId {
  const s = input.trim();
  const url = /congress\.gov\/bill\/(\d+)\w*-congress\/([a-z-]+)\/(\d+)/iu.exec(s);

  if (url) {
    const type = fromCongressGovType.get(url[2]?.toLowerCase() ?? "");

    if (type === undefined) {
      throw new Error(`unknown bill type: ${url[2]}`);
    }

    return billId({ congress: Number(url[1]), type, number: Number(url[3]) });
  }

  const pkg = /^(?:BILLS|BILLSTATUS)-(\d+)([a-z]+?)(\d+)/iu.exec(s);

  if (pkg) {
    return billId({ congress: Number(pkg[1]), type: toType(pkg[2] ?? ""), number: Number(pkg[3]) });
  }

  const canon = /^(\d+)-([a-z]+)-(\d+)$/iu.exec(s);

  if (canon) {
    return billId({ congress: Number(canon[1]), type: toType(canon[2] ?? ""), number: Number(canon[3]) });
  }

  const human = /^([a-z.\s]+?)\s*(\d+)\s*(?:\((\d+)(?:st|nd|rd|th)?\)|,?\s*(\d+)(?:st|nd|rd|th)\s*congress)?$/iu.exec(
    s,
  );

  if (human) {
    const c = human[3] ?? human[4];

    return billId({
      congress: c === undefined ? congress : Number(c),
      type: toType(human[1] ?? ""),
      number: Number(human[2]),
    });
  }

  throw new Error(`not a bill id: ${input}`);
}

function toType(raw: string): BillType {
  const t = raw.toLowerCase().replaceAll(/[^a-z]/gu, "");

  if (isBillType(t)) {
    return t;
  }

  throw new Error(`unknown bill type: ${raw}`);
}

export function billId({ congress, type, number }: BillRef): BillId {
  return `${congress}-${type}-${number}`;
}

export function billRef(id: BillId): BillRef {
  const [congress, type, number] = id.split("-");

  return { congress: Number(congress), type: toType(type ?? ""), number: Number(number) };
}

export function billDisplay(id: BillId): string {
  const { type, number } = billRef(id);

  return `${DISPLAY[type]}${number}`;
}

export function congressGovUrl(id: BillId): string {
  const { congress, type, number } = billRef(id);

  return `https://www.congress.gov/bill/${congress}${ordinal(congress)}-congress/${CONGRESS_GOV_TYPE[type]}/${number}`;
}

export function billstatusUrl(id: BillId): string {
  const { congress, type, number } = billRef(id);

  return `https://www.govinfo.gov/bulkdata/BILLSTATUS/${congress}/${type}/BILLSTATUS-${congress}${type}${number}.xml`;
}

export function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) {
    return "th";
  }

  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}

const SPELLINGS = {
  hr: ["H.R. #", "H.R.#", "HR #", "HR#", "H. R. #"],
  s: ["S. #", "S.#"],
  hjres: ["H.J.Res. #", "H.J. Res. #", "H.J.Res.#", "HJRES #"],
  sjres: ["S.J.Res. #", "S.J. Res. #", "S.J.Res.#", "SJRES #"],
  hconres: ["H.Con.Res. #", "H. Con. Res. #", "HCONRES #"],
  sconres: ["S.Con.Res. #", "S. Con. Res. #", "SCONRES #"],
  hres: ["H.Res. #", "H. Res. #", "H.Res.#", "HRES #"],
  sres: ["S.Res. #", "S. Res. #", "S.Res.#", "SRES #"],
} satisfies Record<BillType, string[]>;

export function lobbyingQuery(id: BillId): string {
  const { type, number } = billRef(id);

  return SPELLINGS[type].map((s) => `"${s.replace("#", String(number))}"`).join(" OR ");
}
