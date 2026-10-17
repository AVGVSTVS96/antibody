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
  [/\bAt&t\b/g, "AT&T"],
  [/\bAmazon Com\b/g, "Amazon.com"],
  [/\bCsx\b/g, "CSX"],
  [/\bUcb\b/g, "UCB"],
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

/** A 0-1 rank as 0-100: where the section stands among the bill's sections (100 = most covered). */
export const rank = (p: number | null | undefined) => (p == null ? "—" : `${Math.round(p * 100)}`);

export const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function day(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number) as [number, number, number];
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** The moment something was recorded, in the reader's time zone. */
export const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

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

/** A signed CBO deficit figure ($ millions) as words: "adds $3.4T to the deficit" / "cuts $63B from the deficit". */
export const deficitWords = (m: number) =>
  `${m < 0 ? "cuts" : "adds"} ${usd(Math.abs(m) * 1e6)} ${m < 0 ? "from" : "to"} the deficit`;

/** CBO's two baselines in a reader's words. */
export const baselineWords = (b: "current-law" | "current-policy") =>
  b === "current-policy" ? "current policy" : "current law";

export const RULES_URL = "https://github.com/AVGVSTVS96/antibody/blob/main/docs/rules.md";

/** Who held Congress and the White House, so a card's era is visible next to its sponsor's party. */
export const CONGRESS_TAG: Record<number, string> = {
  117: "117th Congress · Democratic House, Senate and President",
  118: "118th Congress · Republican House, Democratic Senate and President",
  119: "119th Congress · Republican House, Senate and President",
};

const TRAILING =
  /[,\s]+(inc|incorporated|corp|corporation|co|company|llc|ltd|plc|lp|l\.p|n\.a|s\.a\.?(\s+de\s+c\.v)?|the)\.?$/i;

/** A company or client the way a reader says it: "General Motors", not "GENERAL MOTORS CO". Cut at a word past `max`. */
export function plainName(label: string, max = 22): string {
  const strip = (x: string) => {
    for (let prev = ""; prev !== x; ) {
      prev = x;
      x = x
        .replace(/[/\s]+$/, "")
        .replace(TRAILING, "")
        .replace(/\s*&$/, "");
    }
    return x;
  };
  const s = strip(nice(label).replace(/^the\s+/i, ""));
  if (s.length <= max) return s;
  let out = "";
  for (const w of s.split(" ")) {
    if (out && out.length + w.length + 1 > max) break;
    out = out ? `${out} ${w}` : w;
  }
  return `${strip(out).slice(0, max)}…`;
}
