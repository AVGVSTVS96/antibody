import { BIG_STAKES, headlineDeficit } from "@antibody/core";
import { count, day, musd, usd } from "./format.ts";
import type { BillModel, MemberView, SectionView } from "./model.ts";

type Version = BillModel["versions"][number];
type Roll = BillModel["b"]["votes"][number];

const PASSAGE = /(on passage|and pass\b|motion to concur|conference report)/i;
const NOT_PASSAGE = /(cloture|proceed|recommit|table|reconsider|waive|committee)/i;

const ENGROSSED: Record<string, "House" | "Senate" | undefined> = {
  eh: "House",
  eah: "House",
  es: "Senate",
  eas: "Senate",
};

export const isPassage = (r: Roll) =>
  PASSAGE.test(r.question) &&
  !NOT_PASSAGE.test(r.question) &&
  /pass|agreed|concur/i.test(r.result) &&
  !/fail|reject/i.test(r.result);

const tally = (r: Roll) =>
  `${r.yeas} to ${r.nays}${/tie broken by the vice president/i.test(r.result) ? ", the Vice President broke the tie" : ""}`;

export interface Step {
  label: string;
  detail: string;
  signed: boolean;
}

export function timeline(m: BillModel): Step[] {
  const { b } = m;
  const own = m.versions.filter((v) => !v.predecessor && v.date);
  const first = own[0];
  const rolls = b.votes.filter(isPassage).sort((x, y) => x.date.localeCompare(y.date) || x.number - y.number);
  const lawOn = b.bill.lawOn;
  const lastRoll = rolls.at(-1);
  const fold =
    !!lawOn &&
    !!lastRoll &&
    /concur/i.test(lastRoll.question) &&
    rolls.filter((r) => r.chamber === lastRoll.chamber).length > 1;
  const steps: (Step & { on: string })[] = [];
  if (first)
    steps.push({ label: "First text", detail: `${day(first.date)}, ${first.name}`, signed: false, on: first.date! });

  const passedBy = new Set<string>();
  for (const r of fold ? rolls.slice(0, -1) : rolls) {
    const again = passedBy.has(r.chamber);
    passedBy.add(r.chamber);
    const own = m.versions.find((v) => v.date === r.date && /^(eas|eah)$/.test(v.code));
    steps.push({
      label: again
        ? `${r.chamber} agrees to the final text`
        : own
          ? `${r.chamber} passes its own version`
          : `${r.chamber} passes it`,
      detail: `${day(r.date)}, ${tally(r)}`,
      signed: false,
      on: r.date,
    });
  }
  for (const v of m.versions) {
    const chamber = ENGROSSED[v.code];
    if (!chamber || !v.date || v.predecessor || passedBy.has(chamber)) continue;
    passedBy.add(chamber);
    steps.push({ label: `${chamber} passes it`, detail: day(v.date), signed: false, on: v.date });
  }
  steps.sort((x, y) => x.on.localeCompare(y.on));

  const enr = m.versions.find((v) => v.code === "enr");
  if (lawOn)
    steps.push({
      label: "Signed into law",
      detail: `${day(lawOn)}${fold && lastRoll ? `, after the ${lastRoll.chamber} agreed ${tally(lastRoll)} on ${day(lastRoll.date).replace(/, \d{4}$/, "")}` : ""}`,
      signed: true,
      on: lawOn,
    });
  else if (enr?.date)
    steps.push({ label: "Sent to the President", detail: day(enr.date), signed: false, on: enr.date });
  else if (b.bill.latestAction)
    steps.push({ label: "Latest action", detail: b.bill.latestAction, signed: false, on: "9" });
  return steps.map(({ on: _on, ...s }) => s);
}

export function introLine(m: BillModel): string {
  const { b } = m;
  const finals = m.sections.filter((v) => v.s.inFinal).length;
  const law = !!b.bill.law;
  const parts = [`${count(finals, "section")} ${law ? "became law" : "in the latest text"}.`];
  const d = headlineDeficit(b, "current-law");
  if (d) {
    const years = d.period.split("-").map(Number);
    const span = years[1] && years[0] ? years[1] - years[0] + 1 : null;
    const size = usd(Math.abs(d.amountMusd) * 1e6)
      .replace(/B$/, " billion")
      .replace(/T$/, " trillion")
      .replace(/M$/, " million");
    const over = span ? ` over ${span === 10 ? "ten" : span} years` : "";
    const words =
      Math.abs(d.amountMusd) < 0.5
        ? "has no net effect on the deficit"
        : d.amountMusd < 0
          ? `cuts the deficit by ${size}${over}`
          : `adds ${size} to the deficit${over}`;
    parts.push(`CBO says the ${law ? "law" : "bill"} ${words}.`);
  } else if (b.dollars.estimates.length) parts.push("CBO published an estimate, but its total isn’t read yet.");
  else parts.push("CBO has no score for it.");
  const ranked = m.sections.some((v) => v.s.attention?.pct != null);
  if (ranked) {
    const loud = m.headline.length;
    parts.push(
      `${loud ? `Most of the news covered ${loud} of those sections` : "No section stood out in the news"}${m.buried.length ? `; ${m.buried.length === 1 ? "one costly section" : `${m.buried.length} costly sections`} got almost none.` : "."}`,
    );
  } else parts.push("Too few news articles to say which sections got attention.");
  return parts.join(" ");
}

export interface Answer {
  tone: "loud" | "quiet" | "money" | "trade";
  label: string;
  big: string;
  text: string;
  link: string;
  target: string;
}

export function answers(m: BillModel): Answer[] {
  const { b } = m;
  const A = b.attention;
  const ranked = m.sections.some((v) => v.s.attention?.pct != null);
  const loud = m.headline[0];
  const quiet = m.buried[0];
  const L = b.lobbying;
  const total = L.byPhase.bill + L.byPhase.enactmentQuarter + L.byPhase.law;
  const lateShare = total ? L.byPhase.law / total : 0;
  const first: Answer = loud
    ? {
        tone: "loud",
        label: "What got the attention",
        big: count(loud.s.attention?.hits ?? 0, "article"),
        text: `${A.sample ? `of the ${A.sample.relevant.toLocaleString("en-US")} we read were` : "were"} about §${loud.s.num}, ${trim(loud.s.heading, 56)}, more than any other section.`,
        link: m.headline.length > 1 ? `See the ${m.headline.length} loud sections` : "See the loud section",
        target: "news",
      }
    : {
        tone: "loud",
        label: "What got the attention",
        big: ranked ? "No standout" : "Not enough news",
        text: ranked
          ? "No section got clearly more news than the rest."
          : "Too few articles to say which sections got attention.",
        link: "See every section",
        target: "news",
      };
  const second: Answer = quiet
    ? {
        tone: "quiet",
        label: "What slipped by",
        big: quiet.dollarsMusd != null ? usd(Math.abs(quiet.dollarsMusd) * 1e6) : count(m.buried.length, "section"),
        text: `${quiet.dollarsMusd != null ? `in §${quiet.s.num}, ${trim(quiet.s.heading, 56)}.` : `quiet, with big stakes: §${quiet.s.num}, ${trim(quiet.s.heading, 56)}.`} ${count(quiet.s.attention?.hits ?? 0, "article")} matched it${quiet.s.late ? ", and it was added after the first text" : ""}.`,
        link: "Why it’s flagged",
        target: "news",
      }
    : !ranked || !b.attention.sample
      ? {
          tone: "quiet",
          label: "What slipped by",
          big: "Can’t be tested",
          text: ranked
            ? "The rule can’t fire on this bill."
            : "There are too few news articles to say which sections are quiet.",
          link: "How we test it",
          target: "read",
        }
      : {
          tone: "quiet",
          label: "What slipped by",
          big: "None found",
          text: "No section was big, quiet and either added late or off-topic.",
          link: "How we test it",
          target: "read",
        };
  const third: Answer = {
    tone: "money",
    label: "Who paid to be heard",
    big: count(L.clients, "client"),
    text: `named the bill in ${L.reports.toLocaleString("en-US")} lobbying reports.${total && lateShare > 0.5 ? " Most were filed after it became law." : ""}`,
    link: "Follow the money",
    target: "money",
  };
  const fourth: Answer = {
    tone: "trade",
    label: "Who traded",
    big: count(m.tradersDuring, "member"),
    text: "of 535 traded stock in a company tied to the bill while it moved. Routine disclosures; no link to any vote.",
    link: "See the trades",
    target: "trades",
  };
  return [first, second, third, fourth];
}

export function trim(s: string, max: number): string {
  const clean = s.replace(/\s+/g, " ").replace(/\.$/, "");
  const sentence = clean.charAt(0).toUpperCase() + clean.slice(1);
  if (sentence.length <= max)
    return sentence.charAt(0).toLowerCase() === sentence.charAt(0) ? sentence : lowerFirst(sentence);
  let out = "";
  for (const w of sentence.split(" ")) {
    if (out && out.length + w.length + 1 > max) break;
    out = out ? `${out} ${w}` : w;
  }
  return `${lowerFirst(out)}…`;
}

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

export const sectionName = (s: string, max = 34) => {
  const clean = s.replace(/\s+/g, " ").replace(/\.$/, "");
  const cap = clean.charAt(0).toUpperCase() + clean.slice(1);
  if (cap.length <= max) return cap;
  let out = "";
  for (const w of cap.split(" ")) {
    if (out && out.length + w.length + 1 > max) break;
    out = out ? `${out} ${w}` : w;
  }
  return `${out}…`;
};

export interface Dot {
  v: SectionView;
  hits: number;
  musd: number;
  kind: "headline" | "buried" | "normal";
}

export function dots(m: BillModel): Dot[] {
  return m.sections
    .filter(
      (v) => v.s.inFinal && v.dollarsMusd != null && v.figure?.split !== "even_split" && Math.abs(v.dollarsMusd) >= 100,
    )
    .map((v) => ({
      v,
      hits: v.s.attention?.hits ?? 0,
      musd: v.dollarsMusd!,
      kind: v.kind === "headline" || v.kind === "buried" ? v.kind : "normal",
    }));
}

/** A stable offset in [-1, 1) so dots at the same count spread the same way every render. */
export function spread(id: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (((h >>> 0) % 2001) - 1000) / 1000;
}

export function quietZone(m: BillModel, points: Dot[]): { hits: number; musd: number } | null {
  const ranked = m.sections.some((v) => v.s.attention?.pct != null);
  const flagged = points.filter((p) => p.kind === "buried");
  if (!ranked || !flagged.length) return null;
  return { hits: Math.max(2.5, ...flagged.map((p) => p.hits + 0.5)), musd: BIG_STAKES.dollarsMusd };
}

export interface Era {
  v: Version;
  sections: SectionView[];
  loud: number;
  flagged: number;
  late: boolean;
  title: string;
  note: string | null;
}

const chamberOf = (name: string) => (/house/i.test(name) ? "House" : /senate/i.test(name) ? "Senate" : null);

function eraTitle(v: Version, first: boolean): string {
  const chamber = chamberOf(v.name);
  if (v.predecessor) return "In an earlier bill’s text";
  if (first) return `In the first ${chamber ? `${chamber} ` : ""}text`;
  if (/^(eh|es|eas|eah)$/.test(v.code) && chamber) return `Added when the ${chamber} rewrote it`;
  if (/^(rh|rs|rfh|rfs)$/.test(v.code) && chamber) return `Added in the ${chamber} committee text`;
  if (/^(pcs|pch)$/.test(v.code) && chamber) return `Added when it reached the ${chamber} calendar`;
  if (v.code === "enr") return "Added in the final text";
  return `Added in “${v.name}”`;
}

export function eras(m: BillModel): Era[] {
  const final = m.sections.filter((v) => v.s.inFinal);
  const by = new Map<string, SectionView[]>();
  for (const v of final) by.set(v.s.firstVersion, [...(by.get(v.s.firstVersion) ?? []), v]);
  const lastVote = m.b.votes.filter(isPassage).sort((x, y) => y.date.localeCompare(x.date))[0];
  let seenFirst = false;
  return m.versions
    .filter((v) => by.has(v.code))
    .map((v) => {
      const sections = by.get(v.code)!;
      const first = !seenFirst;
      seenFirst = true;
      const loud = sections.filter((s) => s.kind === "headline").length;
      const flagged = sections.filter((s) => s.kind === "buried").length;
      const late = !m.b.bill.lateUnavailable && sections.filter((s) => s.s.late).length > sections.length / 2;
      const days =
        lastVote && v.date ? Math.round((Date.parse(lastVote.date) - Date.parse(v.date)) / 86_400_000) : null;
      return {
        v,
        sections,
        loud,
        flagged,
        late,
        title: eraTitle(v, first),
        note:
          late && days != null && days >= 0 && days <= 30 && lastVote
            ? `${count(days, "day")} before the final ${lastVote.chamber} vote`
            : null,
      };
    });
}

export function eraLine(e: Era): string {
  const base = count(e.sections.length, "section");
  if (e.note) return `${base}, ${e.note}`;
  const flagged = e.flagged === 1 ? "the flagged one" : `${e.flagged} flagged`;
  if (e.loud && e.flagged) return `${base}: ${e.loud} loud, plus ${flagged}`;
  if (e.loud) return `${base}, ${e.loud} of them loud`;
  if (e.flagged) return `${base}, including ${flagged}`;
  return base;
}

export interface Phase {
  key: "bill" | "enactment" | "law";
  n: number;
  pct: number;
  title: string;
  note: string;
}

export function phases(m: BillModel): { rows: Phase[]; total: number } {
  const p = m.b.lobbying.byPhase;
  const total = p.bill + p.enactmentQuarter + p.law;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const rows: Phase[] = [
    { key: "bill", n: p.bill, pct: pct(p.bill), title: "While the bill moved", note: "" },
    {
      key: "enactment",
      n: p.enactmentQuarter,
      pct: pct(p.enactmentQuarter),
      title: m.b.bill.law ? "The quarter it was signed" : "The latest quarter",
      note: "",
    },
    { key: "law", n: p.law, pct: pct(p.law), title: "After it became law", note: "as agencies wrote the rules" },
  ];
  return { rows, total };
}

export const beforeUsd = (v: MemberView) => v.funded.reduce((a, f) => a + f.edge.props.beforeUsd, 0);

export interface PacRow {
  party: "R" | "D" | "I";
  usd: number;
  got: number;
  of: number;
}

export function pacByParty(m: BillModel): PacRow[] {
  return (["R", "D", "I"] as const)
    .filter((p) => m.voters[p] > 0)
    .map((party) => {
      const got = m.members.filter((v) => v.node.props.party === party && beforeUsd(v) > 0);
      return { party, usd: got.reduce((a, v) => a + beforeUsd(v), 0), got: got.length, of: m.voters[party] };
    });
}

export const PARTY_NAME = { R: "Republicans", D: "Democrats", I: "Independents" } as const;

export const memberLine = (label: string) => label.replace(/\s*\((.*)\)$/, ", $1");

export function passageDate(m: BillModel): string | null {
  const final = m.b.votes.filter(isPassage).sort((x, y) => y.date.localeCompare(x.date))[0];
  return final?.date ?? m.b.bill.lawOn ?? m.span?.[1] ?? null;
}

export interface Trader {
  v: MemberView;
  before: number;
  after: number;
  vote: "Yea" | "Nay" | null;
}

export function traders(m: BillModel): Trader[] {
  const cut = passageDate(m);
  return m.members
    .filter((v) => v.tradeCount)
    .map((v) => {
      const own = v.vote ? m.b.votes.find((r) => r.id === v.vote!.props.rollId)?.date : null;
      const at = own ?? cut;
      const dates = v.trades.flatMap((t) => t.props.events.map((e) => e.date));
      const before = at ? dates.filter((d) => d <= at).length : dates.length;
      const vote = v.vote?.props.vote;
      return { v, before, after: dates.length - before, vote: vote === "Yea" || vote === "Nay" ? vote : null };
    })
    .sort((a, b) => b.v.tradeCount - a.v.tradeCount || a.v.node.label.localeCompare(b.v.node.label));
}

export interface Month {
  key: string;
  n: number;
  during: boolean;
}

export function monthly(m: BillModel): { months: Month[]; total: number } {
  const per = new Map<string, number>();
  let total = 0;
  for (const v of m.members)
    for (const t of v.trades)
      for (const e of t.props.events) {
        const k = e.date.slice(0, 7);
        per.set(k, (per.get(k) ?? 0) + 1);
        total++;
      }
  const keys = [...per.keys()].sort();
  if (!keys.length) return { months: [], total: 0 };
  const months: Month[] = [];
  const [y0, m0] = keys[0]!.split("-").map(Number) as [number, number];
  const [y1, m1] = keys.at(-1)!.split("-").map(Number) as [number, number];
  for (let i = 0; i <= (y1 - y0) * 12 + (m1 - m0); i++) {
    const y = y0 + Math.floor((m0 - 1 + i) / 12);
    const mo = ((m0 - 1 + i) % 12) + 1;
    const key = `${y}-${String(mo).padStart(2, "0")}`;
    const s = m.span;
    months.push({ key, n: per.get(key) ?? 0, during: !!s && key >= s[0].slice(0, 7) && key <= s[1].slice(0, 7) });
  }
  return { months, total };
}

export const niceMax = (n: number) => {
  const step =
    n <= 20 ? 5 : n <= 60 ? 10 : n <= 150 ? 25 : n <= 400 ? 50 : 100 * 10 ** Math.max(0, Math.floor(Math.log10(n)) - 2);
  return Math.max(step, Math.ceil(n / step) * step);
};

export const monthName = (key: string) => {
  const [y, mo] = key.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
};

export { musd };
