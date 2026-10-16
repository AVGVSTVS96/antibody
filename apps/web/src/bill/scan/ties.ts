import type { RingLayout } from "./layout.ts";
import { fmt, pt, R, wrapPi } from "./polar.ts";
import type { RingData } from "./select.ts";

export interface TieShape {
  member: string;
  d: string;
  /** Position in draw order: nearest member first, so the route grows outward from the company. */
  order: number;
  width: number;
  inference: boolean;
  claims: string[];
  weight: number;
}

export interface Spoke {
  d: string;
  order: number;
  inference: boolean;
}

export interface TieSet {
  company: string;
  ties: TieShape[];
  spoke: Spoke | null;
}

const CORNER = 4;
export const TIE_STEP = 2.6;

/** One route: out from the company along its spoke to a shared track, around the ring to the member's angle, then out to the member. */
export function tiePath(a0: number, rStart: number, a1: number, rEnd: number, rb: number): string {
  const d = wrapPi(a1 - a0);
  const arc = Math.abs(d) * rb;
  if (arc < 1.2) return `M${fmt(pt(a0, rStart))}L${fmt(pt(a1, rEnd))}`;
  const dir = d > 0 ? 1 : -1;
  const p = Math.max(0.5, Math.min(CORNER, arc / 2 - 0.5, rEnd - rb - 0.5, rb - rStart - 0.5));
  const da = (p / rb) * dir;
  const sweep = dir > 0 ? 1 : 0;
  return [
    `M${fmt(pt(a0, rStart))}`,
    `L${fmt(pt(a0, rb - p))}`,
    `Q${fmt(pt(a0, rb))} ${fmt(pt(a0 + da, rb))}`,
    `A${rb.toFixed(1)} ${rb.toFixed(1)} 0 0 ${sweep} ${fmt(pt(a1 - da, rb))}`,
    `Q${fmt(pt(a1, rb))} ${fmt(pt(a1, rb + p))}`,
    `L${fmt(pt(a1, rEnd))}`,
  ].join("");
}

/**
 * Every tie of one company, routed so the ones that travel furthest run on the innermost track: shorter routes
 * peel off outside them and never cross. Each direction around the ring has its own set of tracks.
 */
export function tieSet(data: RingData, layout: RingLayout, companyId: string): TieSet {
  const co = layout.company.get(companyId);
  const ties = data.byCompany.get(companyId) ?? [];
  if (!co) return { company: companyId, ties: [], spoke: null };
  const rStart = R.company + co.size / 2 + 3;
  const rMember = data.view === "trades" ? R.member : R.memberDots;
  const peak = Math.max(...ties.map((t) => t.weight), 1);

  const placed = ties.flatMap((t) => {
    const mem = layout.member.get(t.member);
    return mem ? [{ t, mem, d: wrapPi(mem.angle - co.angle) }] : [];
  });
  const byDistance = [...placed].sort((a, b) => Math.abs(a.d) - Math.abs(b.d));
  const track = new Map<string, number>();
  for (const dir of [1, -1]) {
    const side = placed.filter((p) => (p.d >= 0 ? 1 : -1) === dir).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    const step = Math.min(TIE_STEP, (R.trackEnd - R.track) / Math.max(side.length - 1, 1));
    for (const [i, p] of side.entries()) track.set(p.t.member, R.track + i * step);
  }
  const shapes = byDistance.map<TieShape>((p, order) => ({
    member: p.t.member,
    d: tiePath(co.angle, rStart, p.mem.angle, rMember - p.mem.size - 1.5, track.get(p.t.member)!),
    order,
    width: data.view === "trades" ? 1 : 0.6 + Math.sqrt(p.t.weight / peak) * 1.1,
    inference: p.t.inference,
    claims: p.t.claims,
    weight: p.t.weight,
  }));
  return { company: companyId, ties: shapes, spoke: null };
}

export function spokeOf(layout: RingLayout, companyId: string, inference: boolean, order: number): Spoke | null {
  const co = layout.company.get(companyId);
  if (!co) return null;
  const a = co.angle;
  return {
    d: `M${fmt(pt(a, R.core + 2))}L${fmt(pt(a, R.company - co.size / 2 - 3))}`,
    order,
    inference,
  };
}
