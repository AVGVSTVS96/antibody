const ALIAS_PAREN =
  /\((?:F\/?K\/?A|FORMERLY|D\/?B\/?A|ON BEHALF OF)[^)]*\)|\b(?:F\/?K\/?A|D\/?B\/?A|FORMERLY KNOWN AS)\b.*$/g;
const NOISE =
  /\b(?:AND (?:ITS )?(?:AFFILIATES|SUBSIDIARIES)|POLITICAL ACTION COMMITTEE|EMPLOYEES?|FEDERAL|GOOD GOVERNMENT|COMMON STOCK|CLASS [A-C]|ORDINARY SHARES|SPONSORED ADR|ADR|ADS|COMMON|STOCK|SHARES|PAC|FUND|COMMITTEE)\b/g;
const SUFFIX =
  /\b(?:INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LLC|L L C|LP|L P|LLP|LTD|LIMITED|PLC|N ?A|SA|AG|NV|SE|HOLDINGS?|GROUP|THE|DE|NEW|CL [A-C])\b/g;

/**
 * The comparable core of an organization name: upper case, the real client after "OBO", no EDGAR state tags,
 * no aliases, legal suffixes, PAC words or share-class words. "MAYER BROWN LLP OBO CIRCLE INTERNET FINANCIAL"
 * and "Circle Internet Financial, LLC" both become "CIRCLE INTERNET FINANCIAL".
 */
export function norm(name: string | null | undefined): string {
  let s = (name ?? "").toUpperCase().replaceAll("&", " AND ").replaceAll("’", "'");
  s = s.replace(/^.*\b(?:OBO|O\/B\/O|ON BEHALF OF)\b/, " ");
  s = s.replace(/\s*\/[A-Z]{2,3}\/?\s*$|\/ADR\b|\/NEW\//g, " ");
  s = s.replace(ALIAS_PAREN, " ");
  s = s.replace(/\(.*?\)/g, " ");
  s = s.replaceAll("'", "").replace(/[^A-Z0-9 ]+/g, " ");
  s = s.replace(NOISE, " ").replace(SUFFIX, " ");
  return s.replace(/\s+/g, " ").trim();
}

export const tokens = (normalized: string): string[] => (normalized ? normalized.split(" ") : []);

/** A PTR asset line without its "(TICKER)", "[ST]" and share-class tail: "Alphabet Inc. - Class A Common Stock". */
export function assetName(asset: string): string {
  return asset
    .replace(/\[[A-Z]{2}\]\s*$/, "")
    .replace(/\(([A-Z0-9.\-/]{1,8})\)\s*$/, "")
    .replace(/\s+-\s+.*$/, "")
    .trim();
}

/** "(TICKER)" at the end of a PTR asset line, before an optional "[ST]". */
export function tickerInAsset(asset: string): string | null {
  return asset.match(/\(([A-Z][A-Z0-9.-]{0,6})\)\s*(?:\[[A-Z]{2}\])?\s*$/)?.[1] ?? null;
}

/** EDGAR writes share classes with a dash (BRK-B); filings write BRK.B, BRK/B or BRK B. */
export const normTicker = (t: string) => t.trim().toUpperCase().replace(/[./ ]/g, "-");

/**
 * Names that are almost never a public company: associations, governments, schools, tribes, unions.
 * These skip the model review when no SEC name comes close, which keeps the review queue to plausible companies.
 */
export const NON_COMPANY =
  /\b(?:ASSOCIATION|ASSN|ASSOCIATES OF|COALITION|COUNCIL|UNIVERSITY|UNIV|COLLEGE|INITIATIVE|PARTNERSHIP FOR|PROJECT ON|CHAMBER OF|GRANTMAKERS|ADVOCATES|COOPERATIVE|CO-OP|MUTUAL|SCHOOLS?|CITY OF|COUNTY|STATE OF|COMMONWEALTH|TRIBES?|TRIBAL|BAND OF|PUEBLO|FOUNDATION|INSTITUTE|SOCIETY|FEDERATION|ALLIANCE|LEAGUE|CHAMBER OF COMMERCE|AUTHORITY|DISTRICT|COMMISSION|CAMPAIGN|PROJECT|NETWORK FOR|CENTER FOR|AMERICANS FOR|CITIZENS FOR|COMMITTEE FOR|BROTHERHOOD|WORKERS|UNION OF|INTERNATIONAL UNION|FRATERNAL|CONFERENCE|ACADEMY|COLLEGIUM|PORT OF|DEPARTMENT OF|GOVERNMENT OF|EMBASSY|MINISTRY|REPUBLIC OF|KINGDOM OF)\b/;

/** A legal-entity word in the original name, which marks a business even when no SEC name is close. */
export const CORPORATE =
  /\b(?:INC|INCORPORATED|CORP|CORPORATION|LLC|L\.L\.C|LP|LLP|PLC|LTD|LIMITED|CO|COMPANY|HOLDINGS?|GROUP|N\.?A|AG|SA|NV|SE)\b\.?/i;
