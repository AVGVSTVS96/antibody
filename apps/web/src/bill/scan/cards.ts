import { plainName } from "../../lib/format.ts";
import type { Actor, BillModel, MemberView } from "../../lib/model.ts";
import type { SectionGroup } from "./groups.ts";
import type { RingView, Tie } from "./select.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const monthYear = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/** Dollars short enough for a headline number: $515K, $5.4K, $2.3M. */
export function money(n: number): string {
  const trim = (x: number, unit: string) => `$${x.toFixed(1).replace(/\.0$/, "")}${unit}`;
  if (n >= 1e13) return `$${Math.round(n / 1e12)}T`;
  if (n >= 1e12) return trim(n / 1e12, "T");
  if (n >= 1e9) return trim(n / 1e9, "B");
  if (n >= 1e7) return `$${Math.round(n / 1e6)}M`;
  if (n >= 1e6) return trim(n / 1e6, "M");
  if (n >= 1e4) return `$${Math.round(n / 1e3)}K`;
  if (n >= 1e3) return trim(n / 1e3, "K");
  return `$${Math.round(n)}`;
}

const PARTY_NAME = { R: "Republicans", D: "Democrats", I: "independents" } as const;

export const coName = (a: Actor) => plainName(a.label, 34);

export const memberName = (v: MemberView) => {
  const p = v.node.props;
  return `${v.node.label.replace(/\s*\(.*\)$/, "")}, ${p.party}-${p.state}`;
};

export const lastName = (v: MemberView) => {
  const name = v.node.label.replace(/^(Sen|Rep)\.\s+/, "").replace(/\s*\(.*\)$/, "");
  const words = name
    .split(" ")
    .map((w) => w.replace(/,$/, ""))
    .filter((w) => !/^[A-Z]\.$/.test(w) && !/^(Jr|Sr|II|III)\.?$/.test(w));
  return words.at(-1) ?? name;
};

export const memberTag = (v: MemberView) => `${lastName(v)}, ${v.node.props.party}-${v.node.props.state}`;

export interface TraderRow {
  id: string;
  name: string;
  trades: number;
  owners: string[];
  unread: boolean;
  claim: string | null;
}

export interface TradesCard {
  kind: "trades";
  id: string;
  name: string;
  ticker: string | null;
  reports: number;
  rows: TraderRow[];
  trades: number;
  first: string | null;
  last: string | null;
  unread: number;
  sources: string[];
}

export function lobbyingClaims(a: Actor): string[] {
  return [...a.lobbied.flatMap((e) => e.claims), ...a.node.claims, ...(a.benefits?.claims ?? [])];
}

export function tradesCard(m: BillModel, a: Actor, ties: Tie[]): TradesCard {
  const rows = ties
    .map<TraderRow>((t) => {
      const v = m.memberById.get(t.member)!;
      const edge = v.trades.find((e) => m.actorOf(e.dst) === a.id);
      const owners = [...new Set(edge?.props.events.map((e) => e.owner) ?? [])].filter((o) => o !== "self");
      return {
        id: v.node.id,
        name: memberName(v),
        trades: t.weight,
        owners,
        unread: v.node.props.paperFilingsUnread,
        claim: t.claims[0] ?? null,
      };
    })
    .sort((x, y) => y.trades - x.trades || x.name.localeCompare(y.name));
  const dates = ties.flatMap((t) =>
    (m.memberById.get(t.member)?.trades ?? [])
      .filter((e) => m.actorOf(e.dst) === a.id)
      .flatMap((e) => e.props.events.map((ev) => ev.date)),
  );
  dates.sort();
  return {
    kind: "trades",
    id: a.id,
    name: coName(a),
    ticker: a.ticker,
    reports: a.reports,
    rows,
    trades: rows.reduce((s, r) => s + r.trades, 0),
    first: dates[0] ?? null,
    last: dates.at(-1) ?? null,
    unread: rows.filter((r) => r.unread).length,
    sources: lobbyingClaims(a),
  };
}

export interface Bucket {
  label: string;
  members: number;
}

export interface PacCard {
  kind: "pac";
  id: string;
  name: string;
  ticker: string | null;
  total: number;
  members: number;
  average: number;
  parties: string;
  buckets: Bucket[];
  sources: string[];
}

const BUCKETS: [number, string][] = [
  [10000, "$10,000 or more"],
  [5000, "$5,000 to $9,999"],
  [2500, "$2,500 to $4,999"],
  [1000, "$1,000 to $2,499"],
  [0, "Under $1,000"],
];

function partiesPhrase(m: BillModel, ties: Tie[]): string {
  const set = new Set(ties.map((t) => m.memberById.get(t.member)?.node.props.party).filter((p) => p != null));
  if (set.size >= 3) return ", in every party";
  if (set.size === 2) return ", in both parties";
  const only = [...set][0];
  return only ? `, all ${PARTY_NAME[only]}` : "";
}

export function pacCard(m: BillModel, a: Actor, ties: Tie[]): PacCard {
  const total = ties.reduce((s, t) => s + t.weight, 0);
  const counts = BUCKETS.map(() => 0);
  for (const t of ties) counts[BUCKETS.findIndex(([floor]) => t.weight >= floor)]!++;
  return {
    kind: "pac",
    id: a.id,
    name: coName(a),
    ticker: a.ticker,
    total,
    members: ties.length,
    average: ties.length ? total / ties.length : 0,
    parties: partiesPhrase(m, ties),
    buckets: BUCKETS.map(([, label], i) => ({ label, members: counts[i]! })).filter((b) => b.members),
    sources: [...new Set(ties.flatMap((t) => t.claims))].slice(0, 12),
  };
}

export interface SectionRow {
  id: string;
  heading: string;
  musd: number;
  flagged: boolean;
  estimate: boolean;
  claim: string | null;
}

export interface GroupCard {
  kind: "sections";
  id: string;
  name: string;
  count: number;
  priced: number;
  netMusd: number;
  scored: number;
  noNews: number;
  flagged: number;
  rows: SectionRow[];
}

export function groupCard(group: SectionGroup): GroupCard {
  const rows = group.sections
    .filter((v) => v.dollarsMusd != null)
    .map<SectionRow>((v) => ({
      id: v.s.id,
      heading: v.s.heading,
      musd: v.dollarsMusd!,
      flagged: v.kind === "buried",
      estimate: v.s.score?.components.dollarsSplit === "even_split",
      claim: v.figure?.estimate.claim ?? v.s.dollars[0]?.claim ?? null,
    }))
    .sort((a, b) => Math.abs(b.musd) - Math.abs(a.musd));
  const scored = group.sections.filter((v) => v.s.attention);
  return {
    kind: "sections",
    id: group.id,
    name: group.label,
    count: group.sections.length,
    priced: rows.length,
    netMusd: rows.reduce((s, r) => s + r.musd, 0),
    scored: scored.length,
    noNews: scored.filter((v) => v.s.attention!.hits === 0).length,
    flagged: group.sections.filter((v) => v.kind === "buried").length,
    rows,
  };
}

export interface MemberRow {
  id: string;
  name: string;
  value: number;
  claim: string | null;
}

export interface MemberCardData {
  kind: "member";
  view: RingView;
  id: string;
  name: string;
  seat: string;
  rows: MemberRow[];
  total: number;
  first: string | null;
  last: string | null;
  unread: boolean;
  owners: string[];
}

export function memberCard(m: BillModel, v: MemberView, view: RingView, ties: Tie[]): MemberCardData {
  const rows = ties
    .map<MemberRow>((t) => ({
      id: t.company,
      name: coName(m.actorById.get(t.company)!),
      value: t.weight,
      claim: t.claims[0] ?? null,
    }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  const dates = v.trades.flatMap((e) => e.props.events.map((ev) => ev.date)).sort();
  const p = v.node.props;
  return {
    kind: "member",
    view,
    id: v.node.id,
    name: v.node.label.replace(/\s*\(.*\)$/, ""),
    seat: `${p.party}-${p.state}${p.district ? `-${p.district}` : ""}, ${p.chamber}`,
    rows,
    total: rows.reduce((s, r) => s + r.value, 0),
    first: dates[0] ?? null,
    last: dates.at(-1) ?? null,
    unread: p.paperFilingsUnread,
    owners: [...new Set(v.trades.flatMap((e) => e.props.events.map((ev) => ev.owner)))].filter((o) => o !== "self"),
  };
}

export type CardData = TradesCard | PacCard | GroupCard | MemberCardData;
