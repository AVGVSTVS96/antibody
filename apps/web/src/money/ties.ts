import type { EdgeOf, NodeId, NodeOf } from "@antibody/core";
import type { Actor, BillModel, SectionView } from "../lib/model.ts";
import { type Trade, tradeBook, windowCounts } from "../lib/trades.ts";

type Party = NodeOf<"member">["props"]["party"];

/** One lobbying client that named a section (or the bill), and the listed company it is matched to, if any. */
export interface Tie {
  client: NodeOf<"client">;
  /** The filings that name the section, or the bill when the tie is bill-wide. */
  edge: EdgeOf<"lobbied">;
  company: Actor | null;
  resolution: EdgeOf<"resolves_to"> | null;
}

export interface Gifts {
  usd: number;
  members: number;
  claims: string[];
}

/** One row of the ledger: a tie with the stock trades and PAC gifts that follow from it. */
export interface LedgerRow {
  tie: Tie;
  trades: Trade[];
  /** Members with a trade in the company, in total and by party, and how many have one inside the window. */
  traders: { members: number; inWindow: number; byParty: Record<Party, number> };
  gifts: Gifts | null;
}

const clients = new WeakMap<BillModel, Map<NodeId, NodeOf<"client">>>();

function clientById(m: BillModel) {
  let index = clients.get(m);
  if (!index) {
    index = new Map(m.actors.flatMap((a) => a.clients).map((c) => [c.id, c]));
    clients.set(m, index);
  }
  return index;
}

function tiesOf(m: BillModel, dst: string): Tie[] {
  const index = clientById(m);
  const out: Tie[] = [];
  for (const edge of m.b.edges) {
    if (edge.kind !== "lobbied" || edge.dst !== dst) continue;
    const client = index.get(edge.src);
    if (!client) continue;
    const actor = m.actorById.get(m.actorOf(client.id));
    const company = actor?.kind === "company" ? actor : null;
    out.push({
      client,
      edge,
      company,
      resolution: company?.resolutions.find((r) => r.src === client.id) ?? null,
    });
  }
  return out;
}

/** The clients whose filings name a section by its number. */
export const sectionTies = (m: BillModel, v: SectionView) => tiesOf(m, `section:${v.s.id}`);

/** The clients whose filings name the bill as a whole. */
export const billTies = (m: BillModel) => tiesOf(m, m.billNode);

const gifts = new WeakMap<BillModel, Map<NodeId, Gifts>>();

/** What each company's own PACs gave the members the bundle keeps (each member's 5 largest tied donors): a floor. */
function giftsOf(m: BillModel, company: NodeId): Gifts | null {
  let all = gifts.get(m);
  if (!all) {
    all = new Map();
    const givers = new Map<NodeId, Set<NodeId>>();
    for (const mv of m.members)
      for (const f of mv.funded) {
        const g = all.get(f.actor) ?? { usd: 0, members: 0, claims: [] };
        g.usd += f.edge.props.amountUsd;
        g.claims.push(...f.edge.claims);
        all.set(f.actor, g);
        givers.set(f.actor, (givers.get(f.actor) ?? new Set()).add(mv.node.id));
      }
    for (const [id, g] of all) g.members = givers.get(id)!.size;
    gifts.set(m, all);
  }
  return all.get(company) ?? null;
}

export function ledgerRow(m: BillModel, tie: Tie): LedgerRow {
  const trades = tie.company ? (tradeBook(m).byCompany.get(tie.company.id) ?? []) : [];
  const byMember = new Map<NodeId, Trade[]>();
  for (const t of trades) byMember.set(t.member, (byMember.get(t.member) ?? []).concat(t));
  const byParty: Record<Party, number> = { R: 0, D: 0, I: 0 };
  for (const id of byMember.keys()) byParty[m.memberById.get(id)!.node.props.party]++;
  return {
    tie,
    trades,
    traders: {
      members: byMember.size,
      inWindow: [...byMember.values()].filter((t) => windowCounts(t).inside > 0).length,
      byParty,
    },
    gifts: tie.company ? giftsOf(m, tie.company.id) : null,
  };
}

/** Matched clients first, the most members who traded the stock first; unmatched ones after, by name. */
export function ledger(m: BillModel, ties: Tie[]): LedgerRow[] {
  return ties
    .map((t) => ledgerRow(m, t))
    .sort(
      (a, b) =>
        Number(!!b.tie.company) - Number(!!a.tie.company) ||
        b.traders.members - a.traders.members ||
        a.tie.client.label.localeCompare(b.tie.client.label),
    );
}

const METHOD: Record<string, string> = {
  name_exact: "name match",
  alias: "hand-checked alias",
  fuzzy: "close name",
  llm_same: "model: same company",
  llm_subsidiary: "model: subsidiary",
  llm_parent: "model: parent",
};

/** How a client was matched to its company, in the words the rows use. */
export const methodWords = (method: string) => METHOD[method] ?? method.replace(/_/g, " ");

/** The matching rule's own words for what it did, for the weakest-link note. */
export function matchSummary(ties: Tie[]): string {
  const by = (method: string) => ties.filter((t) => t.resolution?.props.method === method).length;
  const matched = ties.filter((t) => t.company).length;
  const model = ties.filter((t) => t.resolution?.props.method.startsWith("llm_")).length;
  const parts: string[] = [];
  const named = [
    [by("name_exact"), "on the exact name"],
    [by("alias"), "through a hand-checked alias"],
    [by("fuzzy"), "on a close name"],
  ] as const;
  const first = named.filter(([n]) => n > 0);
  if (first.length)
    parts.push(
      `${first.map(([n, how], i) => `${n}${i ? "" : ` of these ${ties.length}`} matched ${how}`).join(", ")}.`,
    );
  if (model) {
    const kinds = [
      [by("llm_same"), "same company"],
      [by("llm_subsidiary"), "subsidiary"],
      [by("llm_parent"), "parent"],
    ] as const;
    parts.push(
      `${model} ${first.length ? "needed" : `of these ${ties.length} needed`} a model's judgment (${kinds
        .filter(([n]) => n > 0)
        .map(([n, k]) => `${n} ${k}`)
        .join(", ")}), shown on every row.`,
    );
  }
  if (ties.length > matched) parts.push(`${ties.length - matched} matched no listed company.`);
  return parts.join(" ");
}
