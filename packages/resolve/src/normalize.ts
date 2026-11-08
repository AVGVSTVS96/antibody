const ALIAS_PAREN =
  /\((?:F\/?K\/?A|FORMERLY|D\/?B\/?A|ON BEHALF OF)[^)]*\)|\b(?:F\/?K\/?A|D\/?B\/?A|FORMERLY KNOWN AS)\b.*$/gu;

const NOISE =
  /\b(?:AND (?:ITS )?(?:AFFILIATES|SUBSIDIARIES)|POLITICAL ACTION COMMITTEE|EMPLOYEES?|FEDERAL|GOOD GOVERNMENT|COMMON STOCK|CLASS [A-C]|ORDINARY SHARES|SPONSORED ADR|ADR|ADS|COMMON|STOCK|SHARES|PAC|FUND|COMMITTEE)\b/gu;

const SUFFIX =
  /\b(?:INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LLC|L L C|LP|L P|LLP|LTD|LIMITED|PLC|N ?A|SA|AG|NV|SE|HOLDINGS?|GROUP|THE|DE|NEW|CL [A-C])\b/gu;

export function norm(name: string | null | undefined): string {
  let s = (name ?? "").toUpperCase().replaceAll("&", " AND ").replaceAll("’", "'");
  s = s.replace(/^.*\b(?:OBO|O\/B\/O|ON BEHALF OF)\b/u, " ");
  s = s.replaceAll(/\s*\/[A-Z]{2,3}\/?\s*$|\/ADR\b|\/NEW\//gu, " ");
  s = s.replaceAll(ALIAS_PAREN, " ");
  s = s.replaceAll(/\(.*?\)/gu, " ");
  s = s.replaceAll("'", "").replaceAll(/[^A-Z0-9 ]+/gu, " ");
  s = s.replaceAll(NOISE, " ").replaceAll(SUFFIX, " ");

  return s.replaceAll(/\s+/gu, " ").trim();
}

export const tokens = (normalized: string): string[] => (normalized ? normalized.split(" ") : []);

export interface Asset {
  name: string;
  ticker: string | null;
}

export function parseAsset(asset: string): Asset {
  const s = asset.trim();
  const [, leadTicker, leadName] = /^([A-Z]{1,5}(?:[.-][A-Z])?)\s+-\s+(.+)$/u.exec(s) ?? [];

  if (leadTicker !== undefined && leadName !== undefined) {
    return { name: leadName.replace(/\s+-\s+.*$/u, ""), ticker: leadTicker };
  }

  const [, optionTicker] = /^([A-Z]{1,5})\s+(?:CALLS?|PUTS?)\b/u.exec(s) ?? [];

  if (optionTicker !== undefined) {
    return { name: "", ticker: optionTicker };
  }

  if (/^[A-Z]{1,5}$/u.test(s)) {
    return { name: "", ticker: s };
  }

  const ticker = /\(([A-Z][A-Z0-9.-]{0,6})\)\s*(?:\[[A-Z]{2}\])?\s*$/u.exec(s)?.[1] ?? null;

  const name = s
    .replace(/\[[A-Z]{2}\]\s*$/u, "")
    .replace(/\(([A-Z0-9./-]{1,8})\)\s*$/u, "")
    .replace(/\s+-\s+.*$/u, "")
    .trim();

  return { name, ticker };
}

export const normTicker = (t: string) => t.trim().toUpperCase().replaceAll(/[./ ]/gu, "-");

export const NON_COMPANY =
  /\b(?:ASSOCIATION|ASSN|ASSOCIATES OF|COALITION|COUNCIL|UNIVERSITY|UNIV|COLLEGE|INITIATIVE|PARTNERSHIP FOR|PROJECT ON|CHAMBER OF|GRANTMAKERS|ADVOCATES|COOPERATIVE|CO-OP|MUTUAL|SCHOOLS?|CITY OF|COUNTY|STATE OF|COMMONWEALTH|TRIBES?|TRIBAL|BAND OF|PUEBLO|FOUNDATION|INSTITUTE|SOCIETY|FEDERATION|ALLIANCE|LEAGUE|CHAMBER OF COMMERCE|AUTHORITY|DISTRICT|COMMISSION|CAMPAIGN|PROJECT|NETWORK FOR|CENTER FOR|AMERICANS FOR|CITIZENS FOR|COMMITTEE FOR|BROTHERHOOD|WORKERS|UNION OF|INTERNATIONAL UNION|FRATERNAL|CONFERENCE|ACADEMY|COLLEGIUM|PORT OF|DEPARTMENT OF|GOVERNMENT OF|EMBASSY|MINISTRY|REPUBLIC OF|KINGDOM OF)\b/u;

export const CORPORATE =
  /\b(?:INC|INCORPORATED|CORP|CORPORATION|LLC|L\.L\.C|LP|LLP|PLC|LTD|LIMITED|CO|COMPANY|HOLDINGS?|GROUP|N\.?A|AG|SA|NV|SE)\b\.?/iu;
