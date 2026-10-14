import {
  type Bundle,
  type Claim,
  type Edge,
  type EdgeOf,
  type Figure,
  type Node,
  type NodeId,
  type NodeOf,
  type Section,
  sectionFigure,
} from "@antibody/core";

export type SectionKind = "headline" | "buried" | "normal" | "unscored";

export interface SectionView {
  s: Section;
  kind: SectionKind;
  /** Index of the version it first appeared in (0 = earliest stage, predecessor included). */
  stage: number;
  stageName: string;
  /** Lobbying reports that cite this section by number. */
  lobbied: number;
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
  claim: (id: string) => Claim | undefined;
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
  party: Record<"R" | "D" | "I", number>;
  paperUnread: Bundle["gaps"];
  perSectionDollars: boolean;
}

const byKind = <K extends Edge["kind"]>(edges: Edge[], kind: K) => edges.filter((e): e is EdgeOf<K> => e.kind === kind);

const isNode = <K extends Node["kind"]>(n: Node | undefined, kind: K): n is NodeOf<K> => n?.kind === kind;

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
      lobbied: sectionLobbying.get(s.id) ?? 0,
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
      short: ticker ?? shortName(node.label),
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
  const party = { R: 0, D: 0, I: 0 };
  for (const m of members) if (m.tradeCount || m.fundedUsd) party[m.node.props.party]++;

  const sponsorNode = b.bill.sponsor ? nodeById.get(b.bill.sponsor) : undefined;
  return {
    b,
    billNode,
    claim: (id) => b.claims[id],
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
    party,
    paperUnread: b.gaps.filter((g) => g.kind === "paper_filings_unread"),
    perSectionDollars: b.dollars.estimates.some((e) => e.perSection),
  };
}

const SUFFIX =
  /\b(inc|incorporated|corp|corporation|co|company|llc|ltd|plc|holdings?|group|the|n\.?a\.?|s\.?a\.?|de|c\.?v\.?)\b\.?,?/gi;
const GENERIC =
  /^(american|national|financial|securities|electronic|crypto|independent|consumer|credit|digital|bank|bankers|payments?|global|united|us|mortgage|investment|insurance|international|community|business|chamber|association|council|coalition|institute)$/i;
const MINOR = /^(of|and|for|the|on|in|to|&)$/i;

/**
 * A short map label for an organization without a ticker: its first distinctive word, or its initials when the name
 * starts with a generic word ("American Bankers Association" is ABA, not "American").
 */
export function shortName(label: string): string {
  const words = label
    .replace(/[,.]/g, " ")
    .replace(SUFFIX, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 || w === "&");
  const major = words.filter((w) => !MINOR.test(w));
  if (major.length >= 3 && GENERIC.test(major[0]!))
    return major
      .map((w) => w[0]!.toUpperCase())
      .join("")
      .slice(0, 6);
  const w = major[0] ?? label;
  const t = w === w.toUpperCase() && w.length > 4 ? w[0] + w.slice(1).toLowerCase() : w;
  return t.length > 10 ? `${t.slice(0, 9)}…` : t;
}

export function memberShort(m: NodeOf<"member">): string {
  const name = m.label.replace(/^(Sen|Rep)\.\s+/, "").replace(/\s*\(.*\)$/, "");
  const last =
    name
      .split(" ")
      .filter((w) => !/^[A-Z]\.$/.test(w) && !/^(Jr|Sr|II|III)\.?$/.test(w))
      .at(-1) ?? name;
  return `${last} ${m.props.party}`;
}
