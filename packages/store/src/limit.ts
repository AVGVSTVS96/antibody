import type { Bundle, Edge, NodeId } from "@antibody/core";

/** Same limits for every bill and party: a bundle the site can load in a second or two. */
export const LIMITS = { clients: 300, fundersPerMember: 5 };

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * Bounds how many lobbying clients and PAC donations a bundle draws, by one rule for everyone:
 * - lobbying clients: the `clients` with the most reports naming the bill, plus every client that resolves to a
 *   public company (those carry the stock link); the clients' registrants and lobbyists go when none of their
 *   clients stay;
 * - donations: each member keeps the `fundersPerMember` PACs that gave them the most for this bill's window.
 * What was left out is counted in a gap, and the totals in `bundle.lobbying` still cover everything.
 */
export function limitGraph(b: Bundle, limits = LIMITS): Bundle {
  const reports = new Map<NodeId, number>();
  for (const e of b.edges)
    if (e.kind === "lobbied" && e.src.startsWith("client:") && e.dst.startsWith("bill:") && !e.props.topicOnly)
      reports.set(e.src, (reports.get(e.src) ?? 0) + e.props.reports);
  const resolved = new Set(b.edges.filter((e) => e.kind === "resolves_to").map((e) => e.src));
  const clients = b.nodes.filter((n) => n.kind === "client");
  const top = new Set(
    clients
      .toSorted((a, c) => (reports.get(c.id) ?? 0) - (reports.get(a.id) ?? 0) || a.id.localeCompare(c.id))
      .slice(0, limits.clients)
      .map((n) => n.id),
  );
  const dropped = new Set<NodeId>(clients.filter((n) => !top.has(n.id) && !resolved.has(n.id)).map((n) => n.id));

  const funded = b.edges.filter((e): e is Extract<Edge, { kind: "funded" }> => e.kind === "funded");
  const droppedFunding = new Set<string>();
  const byMember = Map.groupBy(funded, (e) => e.dst);
  for (const es of byMember.values())
    for (const e of es
      .toSorted((a, c) => c.props.amountUsd - a.props.amountUsd || a.id.localeCompare(c.id))
      .slice(limits.fundersPerMember))
      droppedFunding.add(e.id);

  const gone = (e: Edge) => dropped.has(e.src) || dropped.has(e.dst) || droppedFunding.has(e.id);
  b.edges = b.edges.filter((e) => !gone(e));
  const hiring = new Set(b.edges.filter((e) => e.kind === "hired").map((e) => e.dst));
  b.edges = b.edges.filter((e) => e.kind !== "employs" || hiring.has(e.src));
  const touched = new Set(b.edges.flatMap((e) => [e.src, e.dst]));
  const orphan = (id: NodeId) => !touched.has(id) && /^(registrant|lobbyist|pac):/.test(id);
  b.nodes = b.nodes.filter((n) => !dropped.has(n.id) && !orphan(n.id));

  if (dropped.size)
    b.gaps.push({
      id: "clients-limited",
      kind: "other",
      text: `Drawn: the ${fmt(clients.length - dropped.size)} of ${fmt(clients.length)} lobbying clients with the most reports naming this bill, plus every client that resolves to a public company. The other ${fmt(dropped.size)} are in the filings (totals above count all of them).`,
      nodes: [],
      claim: null,
    });
  if (droppedFunding.size)
    b.gaps.push({
      id: "funders-limited",
      kind: "other",
      text: `Drawn: each member's ${limits.fundersPerMember} largest PAC donors from companies tied to this bill. ${fmt(droppedFunding.size)} smaller donations are not drawn; they are in the FEC files.`,
      nodes: [],
      claim: null,
    });
  return b;
}
