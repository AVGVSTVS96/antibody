const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function day(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === "") {
    return "an unknown date";
  }

  const [y, m = Number.NaN, d] = iso.slice(0, 10).split("-").map(Number);

  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function musd(m: number): string {
  const a = Math.abs(m);

  if (a >= 1_000_000) {
    return `$${trim(a / 1_000_000)} trillion`;
  }

  if (a >= 1000) {
    return `$${trim(a / 1000)} billion`;
  }

  if (a >= 1) {
    return `$${trim(a)} million`;
  }

  return `$${Math.round(a * 1_000_000).toLocaleString("en-US")}`;
}

export function usd(n: number): string {
  const a = Math.abs(n);

  return a >= 1_000_000 ? musd(a / 1_000_000) : `$${Math.round(a).toLocaleString("en-US")}`;
}

function trim(x: number): string {
  const digits = x >= 100 ? 0 : x >= 10 ? 1 : 2;

  return Number(x.toFixed(digits)).toLocaleString("en-US");
}

export const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");

  return `${n}${s}`;
}

export const PARTY = { R: "Republican", D: "Democratic", I: "independent" } as const;

const STATES = new Map(
  Object.entries({
    AL: "Alabama",
    AK: "Alaska",
    AZ: "Arizona",
    AR: "Arkansas",
    CA: "California",
    CO: "Colorado",
    CT: "Connecticut",
    DE: "Delaware",
    FL: "Florida",
    GA: "Georgia",
    HI: "Hawaii",
    ID: "Idaho",
    IL: "Illinois",
    IN: "Indiana",
    IA: "Iowa",
    KS: "Kansas",
    KY: "Kentucky",
    LA: "Louisiana",
    ME: "Maine",
    MD: "Maryland",
    MA: "Massachusetts",
    MI: "Michigan",
    MN: "Minnesota",
    MS: "Mississippi",
    MO: "Missouri",
    MT: "Montana",
    NE: "Nebraska",
    NV: "Nevada",
    NH: "New Hampshire",
    NJ: "New Jersey",
    NM: "New Mexico",
    NY: "New York",
    NC: "North Carolina",
    ND: "North Dakota",
    OH: "Ohio",
    OK: "Oklahoma",
    OR: "Oregon",
    PA: "Pennsylvania",
    RI: "Rhode Island",
    SC: "South Carolina",
    SD: "South Dakota",
    TN: "Tennessee",
    TX: "Texas",
    UT: "Utah",
    VT: "Vermont",
    VA: "Virginia",
    WA: "Washington",
    WV: "West Virginia",
    WI: "Wisconsin",
    WY: "Wyoming",
    DC: "the District of Columbia",
    PR: "Puerto Rico",
    GU: "Guam",
    VI: "the U.S. Virgin Islands",
    AS: "American Samoa",
    MP: "the Northern Mariana Islands",
  }),
);

export const stateName = (code: string) => STATES.get(code) ?? code;

export interface MemberLike {
  name: string;
  party: "R" | "D" | "I";
  state: string;
  chamber: "House" | "Senate";
}

export const memberLabel = (m: MemberLike) =>
  `${m.chamber === "Senate" ? "Sen." : "Rep."} ${m.name} (${m.party}-${m.state})`;

export function quarter(period: string): string {
  const p = period.toLowerCase();
  const q = ["first", "second", "third", "fourth"].findIndex((w) => p.startsWith(w));

  if (q !== -1) {
    return `Q${q + 1}`;
  }

  if (p.startsWith("mid")) {
    return "the mid-year period";
  }

  if (p.startsWith("year")) {
    return "the year-end period";
  }

  return period;
}

export const lawNumber = (law: string) => law.replace(/^(?:P\.?\s*L\.?|Public\s+Law)\s*(?:No\.?:?)?\s*/iu, "").trim();

export const quote = (s: string, max = 160) => `"${s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s}"`;
