const UPPER_FIXES: [RegExp, string][] = [
  [/\bJpmorgan\b/g, "JPMorgan"],
  [/\bPnc\b/g, "PNC"],
  [/\bCme\b/g, "CME"],
  [/\bHsbc\b/g, "HSBC"],
  [/\bUs Bancorp\b/g, "US Bancorp"],
  [/\bH&r\b/g, "H&R"],
  [/\bS&p\b/g, "S&P"],
  [/\bPwc\b/g, "PwC"],
  [/\bDao\b/g, "DAO"],
  [/\bPac\b/g, "PAC"],
  [/\bUsa\b/g, "USA"],
  [/\bLlc\b/g, "LLC"],
  [/\bInc\b/g, "Inc"],
];

/** SEC and LDA names arrive in caps with suffixes like "/DE/"; show them the way the company writes itself. */
export function nice(name: string): string {
  let s = name
    .replace(/\s*\/[A-Z]{2,3}\/?$/, "")
    .replace(/\s*\/NEW\/$/, "")
    .replace(/ DE$/, "");
  if (s === s.toUpperCase())
    s = s.toLowerCase().replace(/(^|[\s(&/-])(\w)/g, (_m, a: string, b: string) => a + b.toUpperCase());
  for (const [re, to] of UPPER_FIXES) s = s.replace(re, to);
  return s.replace(/ S A De C V$/, " S.A. de C.V.");
}

export function usd(n: number | null | undefined): string {
  if (n == null) return "—";
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(a >= 1e13 ? 0 : 1)}T`;
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}K`;
  return `${sign}$${Math.round(a)}`;
}

/** CBO prints $ millions; signed, with the sign spelled out so a cut never reads as spending. */
export function musd(m: number): string {
  const s = usd(Math.abs(m) * 1e6);
  return m > 0 ? `+${s}` : m < 0 ? `−${s}` : s;
}

export const pct = (p: number | null | undefined) => (p == null ? "—" : `${Math.round(p * 100)}`);

export const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function day(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number) as [number, number, number];
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function ago(iso: string, now = Date.now()): string {
  const h = (now - Date.parse(iso)) / 36e5;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.floor(h)}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Short name for a source chip, from the record's host. */
export function sourceName(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("lda.gov")) return "LDA";
  if (u.includes("disclosures-clerk")) return "House PTR";
  if (u.includes("efdsearch")) return "Senate eFD";
  if (u.includes("clerk.house.gov")) return "House roll";
  if (u.includes("senate.gov")) return "Senate vote";
  if (u.includes("docquery.fec.gov")) return "FEC filing";
  if (u.includes("fec.gov")) return "FEC";
  if (u.includes("sec.gov")) return "SEC";
  if (u.includes("cbo.gov")) return "CBO";
  if (u.includes("govinfo")) return u.includes("billstatus") ? "BILLSTATUS" : "GovInfo";
  if (u.includes("bioguide")) return "Bioguide";
  if (u.includes("congress.gov")) return "congress.gov";
  if (u.includes("theunitedstates.io")) return "Legislators";
  if (u.includes("github.com/avgvstvs96/antibody")) return "method";
  if (u.includes("news.google.com")) return "news";
  try {
    return new URL(url).hostname.replace(/^www\./, "").split(".")[0]!;
  } catch {
    return "source";
  }
}
