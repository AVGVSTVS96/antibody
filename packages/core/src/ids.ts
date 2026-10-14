export const CURRENT_CONGRESS = 119;

export const BILL_TYPES = ["hr", "s", "hjres", "sjres", "hconres", "sconres", "hres", "sres"] as const;
export type BillType = (typeof BILL_TYPES)[number];

/** Canonical bill id: `<congress>-<type>-<number>`, e.g. `119-s-1582`. */
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

const fromCongressGovType = Object.fromEntries(Object.entries(CONGRESS_GOV_TYPE).map(([k, v]) => [v, k as BillType]));

/**
 * Accepts `119-s-1582`, `S.1582`, `s1582`, `H.R. 1 (119th)`, `HJRES 12`, a congress.gov bill URL,
 * or a GovInfo package name like `BILLS-119hr1enr`. Without a congress, the current one is assumed.
 */
export function parseBillId(input: string, congress = CURRENT_CONGRESS): BillId {
  const s = input.trim();
  const url = s.match(/congress\.gov\/bill\/(\d+)\w*-congress\/([a-z-]+)\/(\d+)/i);
  if (url) return billId({ congress: +url[1]!, type: fromCongressGovType[url[2]!.toLowerCase()]!, number: +url[3]! });
  const pkg = s.match(/^(?:BILLS|BILLSTATUS)-(\d+)([a-z]+?)(\d+)/i);
  if (pkg) return billId({ congress: +pkg[1]!, type: toType(pkg[2]!), number: +pkg[3]! });
  const canon = s.match(/^(\d+)-([a-z]+)-(\d+)$/i);
  if (canon) return billId({ congress: +canon[1]!, type: toType(canon[2]!), number: +canon[3]! });
  const human = s.match(
    /^([a-z.\s]+?)\s*(\d+)\s*(?:\((\d+)(?:st|nd|rd|th)?\)|,?\s*(\d+)(?:st|nd|rd|th)\s*congress)?$/i,
  );
  if (human) {
    const c = human[3] ?? human[4];
    return billId({ congress: c ? +c : congress, type: toType(human[1]!), number: +human[2]! });
  }
  throw new Error(`not a bill id: ${input}`);
}

function toType(raw: string): BillType {
  const t = raw.toLowerCase().replace(/[^a-z]/g, "");
  if ((BILL_TYPES as readonly string[]).includes(t)) return t as BillType;
  throw new Error(`unknown bill type: ${raw}`);
}

export function billId({ congress, type, number }: BillRef): BillId {
  return `${congress}-${type}-${number}`;
}

export function billRef(id: BillId): BillRef {
  const [congress, type, number] = id.split("-");
  return { congress: +congress!, type: type as BillType, number: +number! };
}

/** `S.1582`, `H.R.1`, `H.J.Res.12` */
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

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}
