const UPPER_FIXES: [RegExp, string][] = [
  [/\bJpmorgan\b/gu, "JPMorgan"],
  [/\bPnc\b/gu, "PNC"],
  [/\bCme\b/gu, "CME"],
  [/\bHsbc\b/gu, "HSBC"],
  [/\bUs Bancorp\b/gu, "US Bancorp"],
  [/\bH&r\b/gu, "H&R"],
  [/\bS&p\b/gu, "S&P"],
  [/\bPwc\b/gu, "PwC"],
  [/\bDao\b/gu, "DAO"],
  [/\bPac\b/gu, "PAC"],
  [/\bUsa\b/gu, "USA"],
  [/\bLlc\b/gu, "LLC"],
  [/\bInc\b/gu, "Inc"],
  [/\bAt&t\b/gu, "AT&T"],
  [/\bAmazon Com\b/gu, "Amazon.com"],
  [/\bCsx\b/gu, "CSX"],
  [/\bUcb\b/gu, "UCB"],
];

export function nice(name: string): string {
  let s = name
    .replace(/\s*\/[A-Z]{2,3}\/?$/u, "")
    .replace(/\s*\/NEW\/$/u, "")
    .replace(/ DE$/u, "");

  if (s === s.toUpperCase()) {
    s = s.toLowerCase().replaceAll(/(^|[\s(&/-])(\w)/gu, (_m, a: string, b: string) => a + b.toUpperCase());
  }

  for (const [re, to] of UPPER_FIXES) {
    s = s.replace(re, to);
  }

  return s.replace(/ S A De C V$/u, " S.A. de C.V.");
}

export function usd(n: number | null | undefined): string {
  if (n === null || n === undefined) {
    return "—";
  }

  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";

  if (a >= 1e12) {
    return `${sign}$${(a / 1e12).toFixed(a >= 1e13 ? 0 : 1)}T`;
  }

  if (a >= 1e9) {
    return `${sign}$${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  }

  if (a >= 1e6) {
    return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  }

  if (a >= 1e3) {
    return `${sign}$${Math.round(a / 1e3)}K`;
  }

  return `${sign}$${Math.round(a)}`;
}

export function musd(millions: number): string {
  const s = usd(Math.abs(millions) * 1e6);

  return millions > 0 ? `+${s}` : millions < 0 ? `−${s}` : s;
}

export const rank = (share: number | null | undefined) =>
  share === null || share === undefined ? "—" : `${Math.round(share * 100)}`;

export const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export function day(iso: string | null | undefined): string {
  if ((iso ?? "") === "") {
    return "—";
  }

  return new Date(`${iso?.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function sourceName(url: string): string {
  const u = url.toLowerCase();

  if (u.includes("lda.gov")) {
    return "LDA";
  }

  if (u.includes("disclosures-clerk")) {
    return "House PTR";
  }

  if (u.includes("efdsearch")) {
    return "Senate eFD";
  }

  if (u.includes("clerk.house.gov")) {
    return "House roll";
  }

  if (u.includes("senate.gov")) {
    return "Senate vote";
  }

  if (u.includes("docquery.fec.gov")) {
    return "FEC filing";
  }

  if (u.includes("fec.gov")) {
    return "FEC";
  }

  if (u.includes("sec.gov")) {
    return "SEC";
  }

  if (u.includes("cbo.gov")) {
    return "CBO";
  }

  if (u.includes("govinfo")) {
    return u.includes("billstatus") ? "BILLSTATUS" : "GovInfo";
  }

  if (u.includes("bioguide")) {
    return "Bioguide";
  }

  if (u.includes("congress.gov")) {
    return "congress.gov";
  }

  if (u.includes("theunitedstates.io")) {
    return "Legislators";
  }

  if (u.includes("github.com/avgvstvs96/antibody")) {
    return "method";
  }

  if (u.includes("news.google.com")) {
    return "news";
  }

  try {
    return new URL(url).hostname.replace(/^www\./u, "").split(".")[0] ?? "source";
  } catch {
    return "source";
  }
}

export const deficitWords = (millions: number) =>
  `${millions < 0 ? "cuts" : "adds"} ${usd(Math.abs(millions) * 1e6)} ${millions < 0 ? "from" : "to"} the deficit`;

export const baselineWords = (b: "current-law" | "current-policy") =>
  b === "current-policy" ? "current policy" : "current law";

export const RULES_URL = "https://github.com/AVGVSTVS96/antibody/blob/main/docs/rules.md";

const TRAILING =
  /[,\s]+(inc|incorporated|corp|corporation|co|company|llc|ltd|plc|lp|l\.p|n\.a|s\.a\.?(\s+de\s+c\.v)?|the)\.?$/iu;

function stripSuffixes(name: string): string {
  let prev = "";
  let s = name;

  while (prev !== s) {
    prev = s;
    s = s
      .replace(/[/\s]+$/u, "")
      .replace(TRAILING, "")
      .replace(/\s*&$/u, "");
  }

  return s;
}

export function plainName(label: string, max = 22): string {
  const s = stripSuffixes(nice(label).replace(/^the\s+/iu, ""));

  if (s.length <= max) {
    return s;
  }

  let out = "";

  for (const w of s.split(" ")) {
    if (out !== "" && out.length + w.length + 1 > max) {
      break;
    }

    out = out === "" ? w : `${out} ${w}`;
  }

  return `${stripSuffixes(out).slice(0, max)}…`;
}

export const quoted = (q: string) => `“${q}${/[.;:”"]$/u.test(q) ? "" : "…"}”`;
