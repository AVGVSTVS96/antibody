import type { Actor, BillModel, MemberView } from "../../lib/model.ts";

export type RingView = "trades" | "pac";

export interface Tie {
  company: string;
  member: string;
  /** Trades for the stock view, PAC dollars given before the vote for the money view. */
  weight: number;
  claims: string[];
  inference: boolean;
}

export interface RingData {
  view: RingView;
  companies: Actor[];
  members: MemberView[];
  ties: Tie[];
  byCompany: Map<string, Tie[]>;
  byMember: Map<string, Tie[]>;
  companyWeight: Map<string, number>;
  memberWeight: Map<string, number>;
  /** Everything that could have been drawn, so the page can say how many it left out. */
  candidates: { companies: number; members: number };
}

export const MAX_COMPANIES = 72;
export const MAX_MEMBERS = { trades: 160, pac: 520 } as const;

function aggregate(ties: Tie[]): Tie[] {
  const out = new Map<string, Tie>();
  for (const t of ties) {
    const key = `${t.company}|${t.member}`;
    const prev = out.get(key);
    if (!prev) out.set(key, { ...t, claims: [...t.claims] });
    else {
      prev.weight += t.weight;
      prev.claims.push(...t.claims);
      prev.inference ||= t.inference;
    }
  }
  return [...out.values()];
}

export function tradeTies(m: BillModel): Tie[] {
  const out: Tie[] = [];
  for (const e of m.edges)
    if (e.kind === "traded" && m.actorById.get(e.dst)?.kind === "company")
      out.push({ company: e.dst, member: e.src, weight: e.weight, claims: e.claims, inference: e.inference });
  return aggregate(out);
}

export function pacTies(m: BillModel): Tie[] {
  const display = new Map(m.edges.filter((e) => e.kind === "funded").map((e) => [e.id, e]));
  const out: Tie[] = [];
  for (const v of m.members)
    for (const f of v.funded) {
      if (m.actorById.get(f.actor)?.kind !== "company" || f.edge.props.beforeUsd <= 0) continue;
      const d = display.get(`funded:${f.actor}->${v.node.id}`);
      out.push({
        company: f.actor,
        member: v.node.id,
        weight: f.edge.props.beforeUsd,
        claims: d?.claims ?? f.edge.claims,
        inference: d?.inference ?? f.edge.basis === "inference",
      });
    }
  return aggregate(out);
}

const sum = (xs: Tie[]) => xs.reduce((s, t) => s + t.weight, 0);

function group(ties: Tie[], key: "company" | "member"): Map<string, Tie[]> {
  const out = new Map<string, Tie[]>();
  for (const t of ties) {
    const list = out.get(t[key]);
    if (list) list.push(t);
    else out.set(t[key], [t]);
  }
  return out;
}

/**
 * The companies and members a view draws. Companies are ranked by how many members traded their stock (trades view)
 * or by PAC dollars (money view); `must` ids are kept even when they rank below the cut, so a linked company is on
 * the ring. Members are those tied to a drawn company, biggest first, up to a cap.
 */
export function selectRing(m: BillModel, view: RingView, must: readonly string[] = []): RingData {
  const all = view === "trades" ? tradeTies(m) : pacTies(m);
  const byCo = group(all, "company");
  const rank = (id: string) => {
    const ties = byCo.get(id)!;
    return view === "trades" ? ties.length * 1e9 + sum(ties) * 1e3 + (m.actorById.get(id)?.reports ?? 0) : sum(ties);
  };
  const ids = [...byCo.keys()].sort((a, b) => rank(b) - rank(a) || a.localeCompare(b));
  const top = ids.slice(0, MAX_COMPANIES);
  const keep = new Set(top);
  for (const id of must) {
    if (!byCo.has(id) || keep.has(id)) continue;
    keep.delete(top.pop()!);
    keep.add(id);
  }
  const companies = ids.filter((id) => keep.has(id)).map((id) => m.actorById.get(id)!);

  const inRing = all.filter((t) => keep.has(t.company));
  const byMem = group(inRing, "member");
  const mrank = (id: string) =>
    view === "trades" ? (m.memberById.get(id)?.tradeCount ?? 0) * 1e3 + byMem.get(id)!.length : sum(byMem.get(id)!);
  const memberIds = [...byMem.keys()].sort((a, b) => mrank(b) - mrank(a) || a.localeCompare(b));
  const memberSet = new Set(memberIds.slice(0, MAX_MEMBERS[view]));

  const ties = inRing.filter((t) => memberSet.has(t.member));
  const byCompany = group(ties, "company");
  const byMember = group(ties, "member");
  const members = memberIds.filter((id) => memberSet.has(id)).map((id) => m.memberById.get(id)!);
  return {
    view,
    companies,
    members,
    ties,
    byCompany,
    byMember,
    companyWeight: new Map(
      companies.map((a) => [
        a.id,
        view === "trades" ? (byCompany.get(a.id)?.length ?? 0) : sum(byCompany.get(a.id) ?? []),
      ]),
    ),
    memberWeight: new Map(
      members.map((v) => [v.node.id, view === "trades" ? v.tradeCount : sum(byMember.get(v.node.id) ?? [])]),
    ),
    candidates: { companies: ids.length, members: byMem.size },
  };
}
