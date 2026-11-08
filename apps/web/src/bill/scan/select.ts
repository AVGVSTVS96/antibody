import type { Actor, BillModel, MemberView } from "../../lib/model.ts";

export type RingView = "trades" | "pac";

export interface Tie {
  company: string;
  member: string;
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
  candidates: { companies: number; members: number };
}

export const MAX_COMPANIES = 72;
export const MAX_MEMBERS = { trades: 160, pac: 520 } as const;

function aggregate(ties: Tie[]): Tie[] {
  const out = new Map<string, Tie>();

  for (const t of ties) {
    const key = `${t.company}|${t.member}`;
    const prev = out.get(key);

    if (prev) {
      prev.weight += t.weight;
      prev.claims.push(...t.claims);
      prev.inference ||= t.inference;
    } else {
      out.set(key, { ...t, claims: [...t.claims] });
    }
  }

  return [...out.values()];
}

export function tradeTies(m: BillModel): Tie[] {
  const out: Tie[] = [];

  for (const e of m.edges) {
    if (e.kind === "traded" && m.actorById.get(e.dst)?.kind === "company") {
      out.push({ company: e.dst, member: e.src, weight: e.weight, claims: e.claims, inference: e.inference });
    }
  }

  return aggregate(out);
}

export function pacTies(m: BillModel): Tie[] {
  const display = new Map(m.edges.filter((e) => e.kind === "funded").map((e) => [e.id, e]));
  const out: Tie[] = [];

  for (const v of m.members) {
    for (const f of v.funded) {
      if (m.actorById.get(f.actor)?.kind !== "company" || f.edge.props.beforeUsd <= 0) {
        continue;
      }

      const d = display.get(`funded:${f.actor}->${v.node.id}`);
      out.push({
        company: f.actor,
        member: v.node.id,
        weight: f.edge.props.beforeUsd,
        claims: d?.claims ?? f.edge.claims,
        inference: d?.inference ?? f.edge.basis === "inference",
      });
    }
  }

  return aggregate(out);
}

const sum = (xs: Tie[]) => xs.reduce((s, t) => s + t.weight, 0);

function byRank(groups: Map<string, Tie[]>, rank: (id: string, ties: Tie[]) => number): string[] {
  return [...groups]
    .map(([id, ties]) => ({ id, score: rank(id, ties) }))
    .toSorted((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .map((r) => r.id);
}

function group(ties: Tie[], key: "company" | "member"): Map<string, Tie[]> {
  const out = new Map<string, Tie[]>();

  for (const t of ties) {
    const list = out.get(t[key]);

    if (list) {
      list.push(t);
    } else {
      out.set(t[key], [t]);
    }
  }

  return out;
}

export function selectRing(m: BillModel, view: RingView, must: readonly string[] = []): RingData {
  const all = view === "trades" ? tradeTies(m) : pacTies(m);
  const byCo = group(all, "company");

  const rank = (id: string, ties: Tie[]) =>
    view === "trades" ? ties.length * 1e9 + sum(ties) * 1e3 + (m.actorById.get(id)?.reports ?? 0) : sum(ties);

  const ids = byRank(byCo, rank);
  const top = ids.slice(0, MAX_COMPANIES);
  const keep = new Set(top);

  for (const id of must) {
    if (!byCo.has(id) || keep.has(id)) {
      continue;
    }

    const dropped = top.pop();

    if (dropped !== undefined) {
      keep.delete(dropped);
    }

    keep.add(id);
  }

  const companies = ids.flatMap((id) => {
    const company = keep.has(id) ? m.actorById.get(id) : undefined;

    return company ? [company] : [];
  });

  const inRing = all.filter((t) => keep.has(t.company));
  const byMem = group(inRing, "member");

  const mrank = (id: string, ties: Tie[]) =>
    view === "trades" ? (m.memberById.get(id)?.tradeCount ?? 0) * 1e3 + ties.length : sum(ties);

  const memberIds = byRank(byMem, mrank);
  const memberSet = new Set(memberIds.slice(0, MAX_MEMBERS[view]));

  const ties = inRing.filter((t) => memberSet.has(t.member));
  const byCompany = group(ties, "company");
  const byMember = group(ties, "member");

  const members = memberIds.flatMap((id) => {
    const member = memberSet.has(id) ? m.memberById.get(id) : undefined;

    return member ? [member] : [];
  });

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
