import {
  activeSpan,
  type Bundle,
  type Edge,
  type EdgeOf,
  type Figure,
  type Node,
  type NodeId,
  type NodeOf,
  type Section,
  sectionFigure,
} from "@antibody/core";
import { count, deficitWords, plainName } from "./format.ts";

export type SectionKind = "headline" | "buried" | "normal" | "unscored";

export interface SectionView {
  s: Section;
  kind: SectionKind;
  /** Index of the version it first appeared in (0 = earliest stage, predecessor included). */
  stage: number;
  stageName: string;
  /** Lobbying filings that name this section by number: the count its score used. */
  named: number;
  /** Of those, the reports from clients drawn in the bundle (its lobbied edges). */
  drawn: number;
  dollarsMusd: number | null;
  /** The one CBO estimate the section's dollars come from, with the estimate's own wording (null when none lists it). */
  figure: (Figure & { estimate: Bundle["dollars"]["estimates"][number] }) | null;
}

/**
 * Who acts on the bill, merged the way a reader thinks of them: an LDA client and the PAC of the same company are
 * one actor, drawn as the company when it resolves to one. The merge itself is an inference, so it is kept.
 */
export interface Actor {
  id: NodeId;
  kind: "company" | "client" | "pac";
  label: string;
  short: string;
  ticker: string | null;
  node: Node;
  clients: NodeOf<"client">[];
  pacs: NodeOf<"pac">[];
  resolutions: EdgeOf<"resolves_to">[];
  lobbied: EdgeOf<"lobbied">[];
  benefits: EdgeOf<"benefits"> | null;
  reports: number;
  spendUsd: number | null;
  shareUsd: number | null;
  traders: Set<NodeId>;
  pacUsd: number;
}

export interface MemberView {
  node: NodeOf<"member">;
  trades: EdgeOf<"traded">[];
  tradeCount: number;
  owners: Set<string>;
  funded: { actor: NodeId; edge: EdgeOf<"funded"> }[];
  fundedUsd: number;
  vote: EdgeOf<"voted"> | null;
  sponsor: EdgeOf<"sponsored"> | null;
  inserted: EdgeOf<"inserted">[];
  committees: { committee: NodeOf<"committee">; edge: EdgeOf<"member_of"> }[];
}

export type DisplayKind = "lobbied" | "traded" | "funded" | "voted" | "sponsored" | "inserted";

/** An edge as drawn: endpoints are display ids (bill, section, actor or member). */
export interface DisplayEdge {
  id: string;
  kind: DisplayKind;
  src: string;
  dst: string;
  inference: boolean;
  weight: number;
  claims: string[];
}

export interface BillModel {
  b: Bundle;
  billNode: NodeId;
  versions: Bundle["versions"];
  sections: SectionView[];
  sectionById: Map<string, SectionView>;
  headline: SectionView[];
  buried: SectionView[];
  quiet: SectionView[];
  actors: Actor[];
  actorById: Map<string, Actor>;
  actorOf: (id: NodeId) => NodeId;
  members: MemberView[];
  memberById: Map<string, MemberView>;
  edges: DisplayEdge[];
  sponsor: NodeOf<"member"> | null;
  lobbyists: NodeOf<"lobbyist">[];
  /** Members by party who cast a passage vote on the bill (all drawn members when none did), the size traders are counted against. */
  voters: Record<"R" | "D" | "I", number>;
  /** Members by party whose paper filings we have not read, so their trades cannot be counted. */
  unread: Record<"R" | "D" | "I", number>;
  perSectionDollars: boolean;
  /** Members who traded a tied company's stock, among those with a recorded vote by party (all traders when no one voted). */
  tradersVoted: Record<"R" | "D" | "I", number>;
  /** Traders with no recorded vote on the bill (a chamber that passed it by consent casts none). */
  tradersNoVote: number;
  /** Traders with at least one trade dated inside `span`. */
  tradersDuring: number;
  /** First text through signing (or the last dated action): the span in which a trade could be about the bill. */
  span: [string, string] | null;
  /** `§30002`, with the version in brackets when another section of the bill has the same number. */
  secLabel: (v: SectionView) => string;
  /** What a section is called in a URL: its number when no other section of the bill has it, else its full id. */
  sectionSlug: (v: SectionView) => string;
  sectionBySlug: (slug: string) => SectionView | undefined;
  /** Share of final sections that arrived late (null when the late flag is unavailable). */
  lateShare: number | null;
}

const byKind = <K extends Edge["kind"]>(edges: Edge[], kind: K) => edges.filter((e): e is EdgeOf<K> => e.kind === kind);

const isNode = <K extends Node["kind"]>(n: Node | undefined, kind: K): n is NodeOf<K> => n?.kind === kind;

const models = new WeakMap<Bundle, BillModel>();

/** One model per bundle, so every page and the search box share it. */
export function modelOf(b: Bundle): BillModel {
  const known = models.get(b);
  if (known) return known;
  const m = buildModel(b);
  models.set(b, m);
  return m;
}

export function buildModel(b: Bundle): BillModel {
  const billNode = `bill:${b.bill.id}` as NodeId;
  const nodeById = new Map<string, Node>(b.nodes.map((n) => [n.id, n]));
  const versions = [...b.versions].sort((x, y) => (x.date ?? "").localeCompare(y.date ?? ""));
  const stageOf = new Map(versions.map((v, i) => [v.code, i]));

  const sectionLobbying = new Map<string, number>();
  for (const e of byKind(b.edges, "lobbied"))
    if (e.dst.startsWith("section:"))
      sectionLobbying.set(e.dst.slice(8), (sectionLobbying.get(e.dst.slice(8)) ?? 0) + e.props.reports);

  const estimateById = new Map(b.dollars.estimates.map((e) => [e.id, e]));
  const sections: SectionView[] = b.sections.map((s) => {
    const f = sectionFigure(
      s.dollars.filter((d) => d.baseline === "current-law"),
      b.dollars.estimates,
    );
    const shown = f && (f.fromLatest || !s.inFinal) ? f : null;
    return {
      s,
      kind: s.score ? s.score.label : "unscored",
      stage: stageOf.get(s.firstVersion) ?? 0,
      stageName: versions.find((v) => v.code === s.firstVersion)?.name ?? s.firstVersion,
      named: s.score?.components.lobbyingReports ?? sectionLobbying.get(s.id) ?? 0,
      drawn: sectionLobbying.get(s.id) ?? 0,
      dollarsMusd: shown?.musd ?? null,
      figure: shown && { ...shown, estimate: estimateById.get(shown.estimateId)! },
    };
  });
  const sectionById = new Map(sections.map((v) => [v.s.id, v]));

  const resolvesTo = new Map<string, EdgeOf<"resolves_to">>();
  for (const e of byKind(b.edges, "resolves_to")) resolvesTo.set(e.src, e);
  const actorOf = (id: NodeId): NodeId => {
    let cur = id;
    for (let i = 0; i < 4; i++) {
      const next = resolvesTo.get(cur);
      if (!next) return cur;
      cur = next.dst;
    }
    return cur;
  };
  const chainIsInference = (id: NodeId) => {
    let cur = id;
    for (let i = 0; i < 4; i++) {
      const next = resolvesTo.get(cur);
      if (!next) return false;
      if (next.basis === "inference") return true;
      cur = next.dst;
    }
    return false;
  };

  const actorById = new Map<string, Actor>();
  const actor = (raw: NodeId): Actor | null => {
    const id = actorOf(raw);
    const existing = actorById.get(id);
    if (existing) return existing;
    const node = nodeById.get(id);
    if (!node || (node.kind !== "company" && node.kind !== "client" && node.kind !== "pac")) return null;
    const ticker = node.kind === "company" ? (node.props.tickers[0] ?? null) : null;
    const a: Actor = {
      id,
      kind: node.kind,
      label: node.label,
      short: plainName(node.label),
      ticker,
      node,
      clients: [],
      pacs: [],
      resolutions: [],
      lobbied: [],
      benefits: null,
      reports: 0,
      spendUsd: null,
      shareUsd: null,
      traders: new Set(),
      pacUsd: 0,
    };
    actorById.set(id, a);
    return a;
  };

  for (const n of b.nodes) {
    if (n.kind !== "client" && n.kind !== "pac") continue;
    const a = actor(n.id);
    if (!a) continue;
    if (n.kind === "client") a.clients.push(n);
    if (n.kind === "pac") a.pacs.push(n);
    const r = resolvesTo.get(n.id);
    if (r) a.resolutions.push(r);
  }

  const edges: DisplayEdge[] = [];
  const add = (e: DisplayEdge) => edges.push(e);

  for (const e of byKind(b.edges, "lobbied")) {
    const a = actor(e.src);
    if (!a) continue;
    a.lobbied.push(e);
    a.reports += e.props.reports;
    if (e.props.spendTotalUsd != null) a.spendUsd = (a.spendUsd ?? 0) + e.props.spendTotalUsd;
    if (e.props.shareEstimateUsd != null) a.shareUsd = (a.shareUsd ?? 0) + e.props.shareEstimateUsd;
    add({
      id: e.id,
      kind: "lobbied",
      src: a.id,
      dst: e.dst,
      inference: e.basis === "inference" || chainIsInference(e.src),
      weight: e.props.reports,
      claims: [...e.claims, ...(resolvesTo.get(e.src)?.claims ?? [])],
    });
  }
  for (const e of byKind(b.edges, "benefits")) {
    const a = actorById.get(e.dst) ?? actor(e.dst);
    if (a) a.benefits = e;
  }

  const memberById = new Map<string, MemberView>();
  for (const n of b.nodes)
    if (n.kind === "member")
      memberById.set(n.id, {
        node: n,
        trades: [],
        tradeCount: 0,
        owners: new Set(),
        funded: [],
        fundedUsd: 0,
        vote: null,
        sponsor: null,
        inserted: [],
        committees: [],
      });

  for (const e of byKind(b.edges, "traded")) {
    const m = memberById.get(e.src);
    const a = actor(e.dst);
    if (!m || !a) continue;
    m.trades.push(e);
    m.tradeCount += e.props.events.length;
    for (const ev of e.props.events) m.owners.add(ev.owner);
    a.traders.add(m.node.id);
    add({
      id: e.id,
      kind: "traded",
      src: m.node.id,
      dst: a.id,
      inference: e.basis === "inference",
      weight: e.props.events.length,
      claims: e.claims,
    });
  }

  const fundedAgg = new Map<string, DisplayEdge>();
  for (const e of byKind(b.edges, "funded")) {
    const m = memberById.get(e.dst);
    const a = actor(e.src);
    if (!m || !a) continue;
    m.funded.push({ actor: a.id, edge: e });
    m.fundedUsd += e.props.amountUsd;
    a.pacUsd += e.props.amountUsd;
    const key = `funded:${a.id}->${m.node.id}`;
    const prev = fundedAgg.get(key);
    const inference = e.basis === "inference" || chainIsInference(e.src);
    if (prev) {
      prev.weight += e.props.amountUsd;
      prev.claims.push(...e.claims);
      prev.inference ||= inference;
    } else {
      const d: DisplayEdge = {
        id: key,
        kind: "funded",
        src: a.id,
        dst: m.node.id,
        inference,
        weight: e.props.amountUsd,
        claims: [...e.claims, ...(resolvesTo.get(e.src)?.claims ?? [])],
      };
      fundedAgg.set(key, d);
      add(d);
    }
  }

  for (const e of byKind(b.edges, "voted")) {
    const m = memberById.get(e.src);
    if (!m) continue;
    const roll = b.votes.find((v) => v.id === e.props.rollId);
    const latest = m.vote ? b.votes.find((v) => v.id === m.vote!.props.rollId) : null;
    if (!latest || (roll && roll.date >= latest.date)) m.vote = e;
  }
  for (const m of memberById.values())
    if (m.vote)
      add({
        id: m.vote.id,
        kind: "voted",
        src: m.node.id,
        dst: billNode,
        inference: false,
        weight: 1,
        claims: m.vote.claims,
      });

  for (const e of byKind(b.edges, "sponsored")) {
    const m = memberById.get(e.src);
    if (!m) continue;
    if (e.props.role === "sponsor") m.sponsor = e;
    if (e.props.role === "sponsor" || !e.props.withdrawnOn)
      add({
        id: e.id,
        kind: "sponsored",
        src: m.node.id,
        dst: billNode,
        inference: false,
        weight: 1,
        claims: e.claims,
      });
  }
  for (const e of byKind(b.edges, "inserted")) {
    const m = memberById.get(e.src);
    if (!m) continue;
    m.inserted.push(e);
    add({
      id: e.id,
      kind: "inserted",
      src: m.node.id,
      dst: e.dst,
      inference: e.basis === "inference",
      weight: 1,
      claims: e.claims,
    });
  }
  for (const e of byKind(b.edges, "member_of")) {
    const m = memberById.get(e.src);
    const c = nodeById.get(e.dst);
    if (m && isNode(c, "committee")) m.committees.push({ committee: c, edge: e });
  }

  const scored = sections.filter((v) => v.s.inFinal);
  const headline = scored
    .filter((v) => v.kind === "headline")
    .sort((x, y) => (y.s.attention?.pct ?? 0) - (x.s.attention?.pct ?? 0));
  const buried = scored
    .filter((v) => v.kind === "buried")
    .sort((x, y) => (y.s.score?.buried ?? 0) - (x.s.score?.buried ?? 0));
  const quiet = scored
    .filter((v) => v.kind === "normal" && (v.s.attention?.pct ?? 1) <= 0.25)
    .sort((x, y) => (x.s.attention?.pct ?? 0) - (y.s.attention?.pct ?? 0));

  const members = [...memberById.values()];
  const voters = { R: 0, D: 0, I: 0 };
  const unread = { R: 0, D: 0, I: 0 };
  const voted = members.some((m) => m.vote);
  for (const m of members) {
    if (!voted || m.vote) voters[m.node.props.party]++;
    if (m.node.props.paperFilingsUnread) unread[m.node.props.party]++;
  }

  const tradersVoted = { R: 0, D: 0, I: 0 };
  let tradersNoVote = 0;
  const span = activeSpan(b);
  const tradersDuring = members.filter(
    (m) => span && m.trades.some((t) => t.props.events.some((e) => e.date >= span[0] && e.date <= span[1])),
  ).length;
  for (const m of members) {
    if (!m.tradeCount) continue;
    if (!voted || m.vote) tradersVoted[m.node.props.party]++;
    else tradersNoVote++;
  }
  const numCount = new Map<string, number>();
  for (const v of sections) numCount.set(v.s.num, (numCount.get(v.s.num) ?? 0) + 1);
  const finalSections = sections.filter((v) => v.s.inFinal);

  const sponsorNode = b.bill.sponsor ? nodeById.get(b.bill.sponsor) : undefined;
  return {
    b,
    billNode,
    versions,
    sections,
    sectionById,
    headline,
    buried,
    quiet,
    actors: [...actorById.values()],
    actorById,
    actorOf,
    members,
    memberById,
    edges,
    sponsor: isNode(sponsorNode, "member") ? sponsorNode : null,
    lobbyists: b.nodes.filter((n): n is NodeOf<"lobbyist"> => n.kind === "lobbyist"),
    voters,
    unread,
    perSectionDollars: b.dollars.estimates.some((e) => e.perSection),
    tradersVoted,
    tradersNoVote,
    tradersDuring,
    span,
    secLabel: (v) =>
      (numCount.get(v.s.num) ?? 0) > 1 ? `§${v.s.num} (${v.stageName.replace(/ \(.*\)$/, "")})` : `§${v.s.num}`,
    sectionSlug: (v) => ((numCount.get(v.s.num) ?? 0) > 1 ? v.s.id : v.s.num),
    sectionBySlug: (slug) =>
      sectionById.get(slug) ?? sections.find((v) => v.s.num === slug && numCount.get(slug) === 1),
    lateShare:
      b.bill.lateUnavailable || !finalSections.length
        ? null
        : finalSections.filter((v) => v.s.late).length / finalSections.length,
  };
}

export function memberShort(m: NodeOf<"member">): string {
  const name = m.label.replace(/^(Sen|Rep)\.\s+/, "").replace(/\s*\(.*\)$/, "");
  const last =
    name
      .replace(/,/g, "")
      .split(" ")
      .filter((w) => !/^[A-Z]\.$/.test(w) && !/^(Jr|Sr|II|III|IV)\.?$/.test(w))
      .at(-1) ?? name;
  return `${last} ${m.props.party}`;
}

/** What makes a section's stakes big, in words: its CBO figure and its lobbying reports. */
export function stakesWords(v: SectionView): string {
  return [
    v.dollarsMusd != null && v.s.score?.components.dollarsSplit !== "even_split" ? deficitWords(v.dollarsMusd) : null,
    v.named ? `${count(v.named, "lobbying report")} name it` : null,
  ]
    .filter(Boolean)
    .join(" and ");
}

/** The section closest to the quiet-and-costly rule that did not meet it, so "none" never reads as "not measured". */
export function closestToQuiet(m: BillModel): SectionView | undefined {
  return m.sections
    .filter((v) => v.s.inFinal && v.kind !== "buried" && v.kind !== "headline" && v.s.score?.buried != null)
    .sort((x, y) => y.s.score!.buried! - x.s.score!.buried!)[0];
}
