import type { Bundle, EdgeOf, NodeId, Owner, TradeEvent } from "@antibody/core";
import type { BillModel, MemberView } from "./model.ts";

type Party = MemberView["node"]["props"]["party"];

export interface Trade {
  member: NodeId;
  /** The listed company the trade is in: the edge's end, after clients and PACs are merged into it. */
  company: NodeId;
  edge: EdgeOf<"traded">;
  event: TradeEvent;
  /** Dated from the bill's first text through its signing: `BillModel.span`. */
  inWindow: boolean;
}

export interface TradeBook {
  /** The bill's trade window as the bundle defines it (first text through signing); null when it has no dated text. */
  window: [string, string] | null;
  /** Every trade in the bundle, oldest first. The bundle holds a year before the bill to a year after the law. */
  all: Trade[];
  byMember: ReadonlyMap<NodeId, Trade[]>;
  byCompany: ReadonlyMap<NodeId, Trade[]>;
  /** First and last trade date: the span the monthly counts cover. */
  span: [string, string] | null;
}

const books = new WeakMap<BillModel, TradeBook>();

/** Trade events per member and per company, read once from the bundle's `traded` edges. */
export function tradeBook(m: BillModel): TradeBook {
  const known = books.get(m);
  if (known) return known;
  const window = m.span;
  const all: Trade[] = [];
  for (const mv of m.members)
    for (const edge of mv.trades) {
      const company = m.actorOf(edge.dst);
      for (const event of edge.props.events)
        all.push({
          member: mv.node.id,
          company,
          edge,
          event,
          inWindow: !!window && event.date >= window[0] && event.date <= window[1],
        });
    }
  all.sort((a, b) => a.event.date.localeCompare(b.event.date));
  const group = (key: (t: Trade) => NodeId) => {
    const out = new Map<NodeId, Trade[]>();
    for (const t of all) {
      const list = out.get(key(t));
      if (list) list.push(t);
      else out.set(key(t), [t]);
    }
    return out;
  };
  const book: TradeBook = {
    window,
    all,
    byMember: group((t) => t.member),
    byCompany: group((t) => t.company),
    span: all.length ? [all[0]!.event.date, all.at(-1)!.event.date] : null,
  };
  books.set(m, book);
  return book;
}

/** How many of `trades` fall inside the bill's window and how many outside it. */
export function windowCounts(trades: readonly Trade[]): { inside: number; outside: number } {
  const inside = trades.filter((t) => t.inWindow).length;
  return { inside, outside: trades.length - inside };
}

export interface Month {
  /** `2025-06`. */
  month: string;
  trades: number;
  days: number;
  /** Days of this month that fall inside the bill's window. */
  windowDays: number;
}

const DAY = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Calendar days from `a` through `b`, both counted. */
export const daysBetween = (a: string, b: string) => Math.round((utc(b) - utc(a)) / DAY) + 1;

/**
 * Trades per calendar month over the book's whole span, every month in it listed (an empty one counts 0), so the
 * bars of any member and of everyone line up. Pass a member to count only theirs.
 */
export function monthly(book: TradeBook, member?: NodeId): Month[] {
  if (!book.span) return [];
  const counts = new Map<string, number>();
  for (const t of member ? (book.byMember.get(member) ?? []) : book.all) {
    const k = t.event.date.slice(0, 7);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const [first, last] = book.span.map((d) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1) as [
    number,
    number,
  ];
  const [w0, w1] = book.window ?? ["", ""];
  const out: Month[] = [];
  for (let i = first; i <= last; i++) {
    const year = Math.floor(i / 12);
    const mo = (i % 12) + 1;
    const month = `${year}-${String(mo).padStart(2, "0")}`;
    const days = daysIn(year, mo);
    const from = `${month}-01`;
    const to = `${month}-${String(days).padStart(2, "0")}`;
    const windowDays = book.window ? Math.max(0, daysBetween(w0 > from ? w0 : from, w1 < to ? w1 : to)) : 0;
    out.push({ month, trades: counts.get(month) ?? 0, days, windowDays });
  }
  return out;
}

/** Where a date's start falls along `months`, in month widths from the left edge: `2025-06-16` is 0.5 into June. */
export function monthOffset(months: readonly Month[], iso: string): number {
  const i = months.findIndex((m) => m.month === iso.slice(0, 7));
  if (i < 0) return iso < `${months[0]?.month}-01` ? 0 : months.length;
  return i + (Number(iso.slice(8, 10)) - 1) / months[i]!.days;
}

/** The median number of trades filed by a member who filed any: the baseline a member's own count sits against. */
export function medianPerTrader(book: TradeBook): number {
  const counts = [...book.byMember.values()].map((t) => t.length).sort((a, b) => a - b);
  if (!counts.length) return 0;
  const mid = counts.length >> 1;
  return counts.length % 2 ? counts[mid]! : (counts[mid - 1]! + counts[mid]!) / 2;
}

export interface WindowShare {
  trades: number;
  inside: number;
  /** `inside / trades`. */
  tradeShare: number;
  days: number;
  windowDays: number;
  /** `windowDays / days`: the share of the span's days the window covers, which an even spread of trades would match. */
  dayShare: number;
}

/** What share of all trades fall in the window, beside what share of the span's days the window is. */
export function windowShare(book: TradeBook): WindowShare | null {
  if (!book.window || !book.span) return null;
  const inside = windowCounts(book.all).inside;
  const days = daysBetween(book.span[0], book.span[1]);
  const windowDays = daysBetween(book.window[0], book.window[1]);
  return {
    trades: book.all.length,
    inside,
    tradeShare: inside / book.all.length,
    days,
    windowDays,
    dayShare: windowDays / days,
  };
}

export interface RateCounts {
  members: number;
  /** Members with a trade in one of the companies. */
  traded: number;
  /** Members whose PAC-gift record (their 5 largest tied donors, a floor) includes one of the companies' PACs. */
  gifted: number;
  both: number;
}

export type BaseRate = RateCounts & { byParty: Record<Party, RateCounts> };

const empty = (): RateCounts => ({ members: 0, traded: 0, gifted: 0, both: 0 });

/**
 * How common each tie is among the bundle's members: "7 of 565 got a gift and traded". `companies` narrows it to
 * those companies' stock and PACs (a section's, say); left out, it is every company the bill is tied to.
 */
export function baseRate(m: BillModel, companies?: ReadonlySet<NodeId>): BaseRate {
  const book = tradeBook(m);
  const mine = (id: NodeId) => !companies || companies.has(id);
  const total = empty();
  const byParty: Record<Party, RateCounts> = { R: empty(), D: empty(), I: empty() };
  for (const mv of m.members) {
    const traded = (book.byMember.get(mv.node.id) ?? []).some((t) => mine(t.company));
    const gifted = mv.funded.filter((f) => mine(f.actor)).reduce((sum, f) => sum + f.edge.props.amountUsd, 0) > 0;
    for (const c of [total, byParty[mv.node.props.party]]) {
      c.members++;
      if (traded) c.traded++;
      if (gifted) c.gifted++;
      if (traded && gifted) c.both++;
    }
  }
  return { ...total, byParty };
}

const ties = new WeakMap<BillModel, Map<string, Set<NodeId>>>();

/** The listed companies a lobbying client of any of these sections (ids, not numbers) is merged into. */
export function companiesTiedTo(m: BillModel, sectionIds: Iterable<string>): Set<NodeId> {
  let bySection = ties.get(m);
  if (!bySection) {
    bySection = new Map();
    for (const e of m.edges)
      if (e.kind === "lobbied" && e.dst.startsWith("section:") && m.actorById.get(e.src)?.kind === "company") {
        const id = e.dst.slice(8);
        bySection.set(id, (bySection.get(id) ?? new Set()).add(e.src as NodeId));
      }
    ties.set(m, bySection);
  }
  const out = new Set<NodeId>();
  for (const id of sectionIds) for (const c of bySection.get(id) ?? []) out.add(c);
  return out;
}

export interface Ranked {
  member: MemberView;
  /** How many of the companies the member has traded. */
  companies: number;
  trades: number;
  inWindow: number;
}

/**
 * The one rule that orders every list of members on the site: how many of `companies` a member traded, most first,
 * then by name. Never party, dollars or date. Members who traded none are left out.
 */
export function rankMembers(m: BillModel, companies: ReadonlySet<NodeId>): Ranked[] {
  const book = tradeBook(m);
  const out: Ranked[] = [];
  for (const member of m.members) {
    const mine = (book.byMember.get(member.node.id) ?? []).filter((t) => companies.has(t.company));
    if (mine.length)
      out.push({
        member,
        companies: new Set(mine.map((t) => t.company)).size,
        trades: mine.length,
        inWindow: windowCounts(mine).inside,
      });
  }
  return out.sort((a, b) => b.companies - a.companies || a.member.node.label.localeCompare(b.member.node.label));
}

/** The bundle's notes on what the trade counts leave out: paper filings not read, options and bonds, unmatched filers. */
export function tradeGaps(b: Bundle): Bundle["gaps"] {
  return b.gaps.filter((g) => g.kind === "paper_filings_unread" || /^[\d,]+ trades /.test(g.text));
}

const OWNER: Record<Owner, string> = {
  self: "own account",
  spouse: "spouse's account",
  joint: "joint account",
  dependent: "dependent's account",
};

/** Whose account a trade was in, as the filing lists it. Shown on every trade. */
export const ownerWords = (owner: Owner) => OWNER[owner];

const VERB: Record<TradeEvent["type"], string> = {
  purchase: "bought",
  sale: "sold",
  sale_partial: "part-sold",
  exchange: "exchanged",
};

export const tradeVerb = (type: TradeEvent["type"]) => VERB[type];

/** Trades grouped by whose account they were in, the most first: shown beside every member's trades. */
export function byOwner(trades: readonly Trade[]): { owner: Owner; count: number }[] {
  const counts = new Map<Owner, number>();
  for (const t of trades) counts.set(t.event.owner, (counts.get(t.event.owner) ?? 0) + 1);
  return [...counts].map(([owner, count]) => ({ owner, count })).sort((a, b) => b.count - a.count);
}

const floor = (amount: string) => Number(/\$([\d,]+)/.exec(amount)?.[1]?.replace(/,/g, "") ?? 0);

/** Trades grouped by the amount range the filing gives (it is a range, never a value), smallest range first. */
export function byAmount(trades: readonly Trade[]): { amount: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of trades) counts.set(t.event.amount, (counts.get(t.event.amount) ?? 0) + 1);
  return [...counts].map(([amount, count]) => ({ amount, count })).sort((a, b) => floor(a.amount) - floor(b.amount));
}
