import Graph from "graphology";
import type { Attributes } from "graphology-types";
import type Sigma from "sigma";
import type { Actor, BillModel, DisplayKind, MemberView, SectionView } from "../lib/model.ts";
import { memberShort } from "../lib/model.ts";

/**
 * Both map views come from one graph: every node carries its radial position (r*) and its money-map position (m*),
 * and switching views animates x/y/size/alpha between the two. Positions are in screen convention (y down, angle 0
 * at 3 o'clock, clockwise), stored with y flipped because sigma's graph space points y up.
 */

export const RADIUS = 500;
export const RING = {
  badge: 74,
  sections: [122, 238] as const,
  actors: [270, 374] as const,
  members: [412, 486] as const,
};
const MAX_ACTORS = 90;
const MAX_MEMBERS = 180;
const MONEY_COMPANIES = 45;
const MONEY_MEMBERS = 70;
export const MONEY_TIES = 70;
export const MONEY_HALF = 300;

export type Tone =
  | "violet"
  | "gold"
  | "red"
  | "teal"
  | "steel"
  | "grey"
  | "panel"
  | "seal"
  | "card"
  | "dim"
  | "muted"
  | "text";
export type MapKind = "bill" | "section" | "actor" | "member";

export interface NodeAttrs {
  kind: MapKind;
  label: string;
  shape: "circle" | "square" | "diamond";
  tone: Tone;
  fillAlpha: number;
  border: Tone;
  borderSize: number;
  labelTone: Tone;
  rx: number;
  ry: number;
  rsize: number;
  ralpha: number;
  rlabel: LabelPos;
  mx: number;
  my: number;
  msize: number;
  malpha: number;
  mlabel: LabelPos;
  x: number;
  y: number;
  size: number;
  alpha: number;
  important: number;
  lrank: number;
  mimportant: number;
  mlrank: number;
  mweight: number;
  weight: number;
  halo: "headline" | "buried" | null;
}

export interface EdgeAttrs {
  kind: DisplayKind;
  tone: Tone;
  inference: boolean;
  width: number;
  base: number;
  curvature: number;
  mwidth: number;
  mbase: number;
  mshare: number;
  views: ("map" | "money")[];
}

export type NS = { isActive: boolean; isHovered: boolean; isTarget: boolean };
export type GS = { focused: boolean; tick: number; zoomed: boolean };
export type Renderer = Sigma<
  NodeAttrs,
  EdgeAttrs,
  Attributes,
  { isActive: boolean; isTarget: boolean },
  { isActive: boolean },
  GS
>;

export type LabelPos = "right" | "left" | "above" | "below" | "over";

export interface Stage {
  code: string;
  name: string;
  r: number;
}

export interface Built {
  graph: Graph<NodeAttrs, EdgeAttrs>;
  stages: Stage[];
  counts: Record<DisplayKind, number>;
  shown: { sections: number; actors: number; members: number; actorsTotal: number; membersTotal: number };
}

const TAU = Math.PI * 2;
const at = (a: number, r: number) => ({ x: Math.cos(a) * r, y: Math.sin(a) * r });
const labelSide = (a: number): LabelPos => {
  const c = Math.cos(a);
  if (c > 0.3) return "right";
  if (c < -0.3) return "left";
  return Math.sin(a) > 0 ? "below" : "above";
};

export function actorWeight(a: Actor) {
  return a.traders.size * 4 + Math.sqrt(a.reports) * 2 + Math.sqrt(a.pacUsd / 1e4);
}
export function memberWeight(v: MemberView) {
  return v.tradeCount * 3 + v.fundedUsd / 2e4 + (v.sponsor ? 10 : 0) + v.inserted.length * 6;
}

export function buildGraph(m: BillModel): Built {
  const g = new Graph<NodeAttrs, EdgeAttrs>({ multi: true, type: "directed" });
  const base = {
    shape: "circle" as const,
    fillAlpha: 1,
    border: "violet" as Tone,
    borderSize: 0,
    labelTone: "dim" as Tone,
    mx: 0,
    my: 0,
    msize: 0,
    malpha: 0,
    mlabel: "right" as LabelPos,
    important: 0,
    lrank: 99,
    mimportant: 0,
    mlrank: 99,
    mweight: 0,
    weight: 0,
    halo: null,
  };
  const add = (
    id: string,
    a: Omit<NodeAttrs, "x" | "y" | "size" | "alpha" | keyof typeof base> & Partial<NodeAttrs>,
  ) => {
    const attrs = { ...base, labelTone: "dim" as Tone, ...a } as NodeAttrs;
    attrs.x = attrs.rx;
    attrs.y = -attrs.ry;
    attrs.size = attrs.rsize;
    attrs.alpha = attrs.ralpha;
    g.addNode(id, attrs);
  };

  add(m.billNode, {
    kind: "bill",
    label: "",
    tone: "seal",
    border: "red",
    borderSize: 0.03,
    rx: 0,
    ry: 0,
    rsize: RING.badge - 8,
    ralpha: 1,
    rlabel: "over",
    important: 1,
  });

  const stageCodes = m.versions.map((v) => v.code).filter((c) => m.sections.some((s) => s.s.firstVersion === c));
  const [s0, s1] = RING.sections;
  const lo = s0 + 22;
  const hi = s1 - 22;
  const stages: Stage[] = stageCodes.map((code, i) => ({
    code,
    name: m.versions.find((v) => v.code === code)!.name,
    r: stageCodes.length === 1 ? (lo + hi) / 2 : lo + (i * (hi - lo)) / (stageCodes.length - 1),
  }));
  const stageR = new Map(stages.map((s) => [s.code, s.r]));

  const sections = [...m.sections];
  const ns = sections.length || 1;
  const sectionAngle = new Map<string, number>();
  const maxSec = Math.max(1.2, ((TAU * lo) / ns) * 0.46);
  sections.forEach((v: SectionView, i) => {
    const a = -Math.PI / 2 + (i / ns) * TAU;
    sectionAngle.set(v.s.id, a);
    const p = at(a, stageR.get(v.s.firstVersion) ?? (lo + hi) / 2);
    const scoredPct = v.s.attention?.pct;
    const tone: Tone = !v.s.inFinal ? "panel" : v.kind === "buried" ? "red" : v.kind === "headline" ? "gold" : "violet";
    const solid = v.kind === "buried" || v.kind === "headline" || (scoredPct ?? 0) > 0.5;
    add(`section:${v.s.id}`, {
      kind: "section",
      label: v.s.num,
      tone,
      fillAlpha: !v.s.inFinal
        ? 1
        : v.kind === "buried" || v.kind === "headline"
          ? 1
          : scoredPct == null
            ? 0.28
            : 0.3 + scoredPct * 0.7,
      border: !v.s.inFinal ? "grey" : tone,
      borderSize: !v.s.inFinal ? 0.22 : 0.08,
      labelTone: solid ? "panel" : "text",
      rx: p.x,
      ry: p.y,
      rsize: Math.min(maxSec, 6.5 + Math.sqrt(v.s.words) / 9),
      ralpha: 1,
      rlabel: "over",
      important: ns <= 60 ? 1 : 0,
      halo: v.kind === "headline" || v.kind === "buried" ? v.kind : null,
    });
  });

  const actorsAll = m.actors.filter((a) => a.lobbied.length || a.traders.size || a.pacUsd > 0);
  const actors = [...actorsAll].sort((x, y) => actorWeight(y) - actorWeight(x)).slice(0, MAX_ACTORS);
  const actorAngle = new Map<string, number>();
  const [a0, a1] = RING.actors;
  const ar = (a0 + a1) / 2;
  {
    const sectionTargeted = (a: Actor) => {
      const angles = a.lobbied.filter((e) => e.dst.startsWith("section:")).map((e) => sectionAngle.get(e.dst.slice(8)));
      const xs = angles.filter((x): x is number => x != null);
      if (!xs.length) return null;
      return Math.atan2(
        xs.reduce((s, x) => s + Math.sin(x), 0),
        xs.reduce((s, x) => s + Math.cos(x), 0),
      );
    };
    const n = actors.length || 1;
    const slots = actors.map((_, i) => -Math.PI / 2 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (TAU / n));
    const wants = actors.map(sectionTargeted);
    if (wants.some((w) => w != null)) {
      const order = actors.map((a, i) => ({ a, w: wants[i] ?? slots[i]! })).sort((x, y) => x.w - y.w);
      placeEvenly(order, (o, ang) => actorAngle.set(o.a.id, ang));
    } else for (const [i, a] of actors.entries()) actorAngle.set(a.id, slots[i]!);
  }
  const maxActor = Math.max(6, ((TAU * ar) / (actors.length || 1)) * 0.45);
  for (const a of actors) {
    const ang = actorAngle.get(a.id)!;
    const p = at(ang, ar);
    const hollow = a.kind !== "company";
    add(a.id, {
      kind: "actor",
      label: a.short,
      shape: a.kind === "pac" ? "diamond" : "square",
      tone: hollow ? "panel" : "violet",
      fillAlpha: hollow ? 1 : 0.88,
      border: "violet",
      borderSize: hollow ? 0.38 : 0,
      labelTone: "text",
      rx: p.x,
      ry: p.y,
      rsize: Math.min(maxActor, 6.5 + Math.sqrt(a.reports) * 0.8 + a.traders.size * 0.15),
      ralpha: 1,
      rlabel: labelSide(ang),
      weight: actorWeight(a),
    });
  }

  const membersAll = m.members.filter((v) => v.tradeCount || v.fundedUsd > 0 || v.sponsor || v.inserted.length);
  const members = [...membersAll].sort((x, y) => memberWeight(y) - memberWeight(x)).slice(0, MAX_MEMBERS);
  const memberAngle = new Map<string, number>();
  {
    const wants = members.map((v) => {
      let x = 0;
      let y = 0;
      for (const t of v.trades) {
        const a = actorAngle.get(m.actorOf(t.dst));
        if (a != null) {
          x += Math.cos(a) * 3 * t.props.events.length;
          y += Math.sin(a) * 3 * t.props.events.length;
        }
      }
      for (const f of v.funded.slice(0, 6)) {
        const a = actorAngle.get(f.actor);
        if (a != null) {
          x += Math.cos(a);
          y += Math.sin(a);
        }
      }
      return { v, w: x || y ? Math.atan2(y, x) : Math.PI / 2 };
    });
    wants.sort((p, q) => p.w - q.w);
    placeEvenly(wants, (o, ang) => memberAngle.set(o.v.node.id, ang));
  }
  const [m0, m1] = RING.members;
  const mr = (m0 + m1) / 2;
  const maxMember = Math.max(5.5, ((TAU * mr) / (members.length || 1)) * 0.5);
  for (const v of members) {
    const ang = memberAngle.get(v.node.id)!;
    const p = at(ang, mr);
    const vote = v.vote?.props.vote;
    add(v.node.id, {
      kind: "member",
      label: memberShort(v.node),
      tone: vote === "Yea" ? "violet" : "panel",
      fillAlpha: 1,
      border: v.sponsor ? "gold" : v.inserted.length ? "teal" : vote ? "violet" : "dim",
      borderSize: v.sponsor || v.inserted.length ? 0.4 : vote === "Yea" ? 0 : 0.4,
      labelTone: "text",
      rx: p.x,
      ry: p.y,
      rsize: Math.min(maxMember, 5.5 + Math.sqrt(v.tradeCount + v.fundedUsd / 2e4) * 0.6),
      ralpha: 1,
      rlabel: labelSide(ang),
      weight: memberWeight(v) + (v.sponsor ? 1e3 : 0),
    });
  }

  const counts = { lobbied: 0, traded: 0, funded: 0, voted: 0, sponsored: 0, inserted: 0 } as Record<
    DisplayKind,
    number
  >;
  const peak = { traded: 1, funded: 1 };
  for (const e of m.edges)
    if (e.kind === "traded" || e.kind === "funded") peak[e.kind] = Math.max(peak[e.kind], e.weight);
  for (const e of m.edges) {
    const src = e.src;
    const dst = e.dst;
    if (!g.hasNode(src) || !g.hasNode(dst) || g.hasEdge(e.id)) continue;
    const toCenter = dst === m.billNode;
    const share = e.kind === "traded" || e.kind === "funded" ? Math.sqrt(e.weight / peak[e.kind]) : 0;
    const style: Pick<EdgeAttrs, "tone" | "width" | "base" | "views"> =
      e.kind === "lobbied"
        ? { tone: "violet", width: 1.3, base: 0.42, views: ["map"] }
        : e.kind === "traded"
          ? { tone: "steel", width: Math.min(0.6 + e.weight * 0.12, 2.2), base: 0.07, views: ["map", "money"] }
          : e.kind === "funded"
            ? { tone: "gold", width: Math.min(0.4 + e.weight / 4e4, 2), base: 0.2, views: ["map", "money"] }
            : e.kind === "voted"
              ? { tone: "grey", width: 0.6, base: 0.14, views: ["map"] }
              : e.kind === "inserted"
                ? { tone: "teal", width: 0.9, base: 0.3, views: ["map"] }
                : { tone: "gold", width: 1, base: 0.5, views: ["map"] };
    g.addDirectedEdgeWithKey(e.id, src, dst, {
      kind: e.kind,
      inference: e.inference,
      curvature: toCenter ? 0 : 0.22,
      mwidth: 0.9 + share * 3,
      mbase: 0.3 + share * 0.5,
      mshare: share,
      ...style,
    });
    counts[e.kind]++;
  }

  moneyLayout(g, m);
  cullLabels(g, "map", 0.45);
  return {
    graph: g,
    stages,
    counts,
    shown: {
      sections: sections.length,
      actors: actors.length,
      members: members.length,
      actorsTotal: actorsAll.length,
      membersTotal: membersAll.length,
    },
  };
}

/** Even spacing in the order given, rotated as a whole to sit closest to where each item wants to be. */
function placeEvenly<T extends { w: number }>(items: T[], set: (item: T, angle: number) => void) {
  const n = items.length;
  if (!n) return;
  const step = TAU / n;
  let best = 0;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let k = 0; k < 72; k++) {
    const off = -Math.PI + (k / 72) * step;
    let cost = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.atan2(Math.sin(off + i * step - items[i]!.w), Math.cos(off + i * step - items[i]!.w));
      cost += d * d;
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = off;
    }
  }
  for (const [i, it] of items.entries()) set(it, best + i * step);
}

const CHAR_W = 6.6;
const LABEL_H = 15;
const LABEL_GAP = 4;
const LABEL_PAD = 4;
const PER_KIND = 14;

interface Pin {
  id: string;
  x: number;
  y: number;
  size: number;
  side: LabelPos;
  chars: number;
  weight: number;
}

/** Greedy by weight: a label is kept only if its box clears every box already kept, so labels never pile up. */
function cull(pins: Pin[], cap: number): string[] {
  const kept: { id: string; x0: number; x1: number; y0: number; y1: number }[] = [];
  for (const p of [...pins].sort((a, b) => b.weight - a.weight)) {
    if (kept.length >= cap) break;
    const w = p.chars * CHAR_W + 6;
    const d = p.size + LABEL_GAP;
    const x0 = p.side === "right" ? p.x + d : p.side === "left" ? p.x - d - w : p.x - w / 2;
    const y0 = p.side === "above" ? p.y - d - LABEL_H : p.side === "below" ? p.y + d : p.y - LABEL_H / 2;
    const box = { id: p.id, x0, x1: x0 + w, y0, y1: y0 + LABEL_H };
    if (
      kept.some(
        (k) =>
          box.x0 < k.x1 + LABEL_PAD &&
          box.x1 > k.x0 - LABEL_PAD &&
          box.y0 < k.y1 + LABEL_PAD &&
          box.y1 > k.y0 - LABEL_PAD,
      )
    )
      continue;
    kept.push(box);
  }
  return kept.map((k) => k.id);
}

/**
 * Which company and member labels fit at this scale (screen pixels per graph unit at the unzoomed fit). The boxes
 * are measured in pixels, so a small map keeps fewer labels than a big one and they still never overlap.
 */
export function cullLabels(g: Graph<NodeAttrs, EdgeAttrs>, view: "map" | "money", k: number) {
  const radial = view === "map";
  const pins: Record<"actor" | "member", Pin[]> = { actor: [], member: [] };
  g.forEachNode((id, a) => {
    if (a.kind !== "actor" && a.kind !== "member") return;
    if (radial)
      pins[a.kind].push({
        id,
        x: a.rx * k,
        y: a.ry * k,
        size: a.rsize * k,
        side: a.rlabel,
        chars: a.label.length,
        weight: a.weight,
      });
    else if (a.malpha > 0)
      pins[a.kind].push({
        id,
        x: a.mx * k,
        y: a.my * k,
        size: a.msize * k,
        side: a.mlabel,
        chars: a.label.length,
        weight: a.mweight,
      });
    g.mergeNodeAttributes(id, radial ? { important: 0, lrank: 99 } : { mimportant: 0, mlrank: 99 });
  });
  const keep = [...cull(pins.actor, PER_KIND), ...cull(pins.member, PER_KIND)].sort(
    (x, y) =>
      g.getNodeAttribute(y, radial ? "weight" : "mweight") - g.getNodeAttribute(x, radial ? "weight" : "mweight"),
  );
  for (const [i, id] of keep.entries())
    g.mergeNodeAttributes(id, radial ? { important: 1, lrank: i } : { mimportant: 1, mlrank: i });
}

/**
 * Money map: companies in a left column and members in a right one, joined by stock trades and PAC money. Each
 * column is ordered by the average position of what it connects to, so lines that belong together run together,
 * and a node's size is its dollars (or trades).
 */
function moneyLayout(g: Graph<NodeAttrs, EdgeAttrs>, m: BillModel) {
  const links = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      if (!links.has(x)) links.set(x, new Set());
      links.get(x)!.add(y);
    }
  };
  g.forEachEdge((_k, e, src, dst) => {
    if (e.kind === "traded" || e.kind === "funded") link(src, dst);
  });
  if (!links.size) return;
  const dollars = (id: string) => {
    const actor = m.actorById.get(id);
    if (actor) return actor.pacUsd / 2e4 + actor.traders.size * 3;
    const member = m.memberById.get(id);
    return member ? member.fundedUsd / 2e4 + member.tradeCount : 0;
  };
  const sideOf = (id: string) => (g.getNodeAttribute(id, "kind") === "actor" ? "L" : "R");
  const left = [...links.keys()]
    .filter((id) => sideOf(id) === "L")
    .sort((a, b) => dollars(b) - dollars(a))
    .slice(0, MONEY_COMPANIES);
  const right = [...links.keys()]
    .filter((id) => sideOf(id) === "R")
    .sort((a, b) => dollars(b) - dollars(a))
    .slice(0, MONEY_MEMBERS);
  const sizeOf = (id: string, cap: number) => Math.min(cap, 3.6 + Math.sqrt(dollars(id)) * 1.5);
  const column = (ids: string[]) => {
    const h = ids.map((id) => 2 * sizeOf(id, 13) + 2.5);
    const total = h.reduce((a, b) => a + b, 0);
    const fit = Math.min(1, (2 * (RADIUS - 70)) / total);
    const ys = new Map<string, number>();
    let y = (-total * fit) / 2;
    ids.forEach((id, i) => {
      ys.set(id, y + (h[i]! * fit) / 2);
      y += h[i]! * fit;
    });
    return { ys, fit };
  };
  const place = (ids: string[], at: Map<string, number>) => {
    const key = (id: string) => {
      const ys = [...links.get(id)!].map((o) => at.get(o)).filter((v): v is number => v != null);
      return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0;
    };
    return [...ids].sort((a, b) => key(a) - key(b));
  };
  let L = left;
  let R = right;
  let cl = column(L);
  let cr = column(R);
  for (let i = 0; i < 6; i++) {
    R = place(R, cl.ys);
    cr = column(R);
    L = place(L, cr.ys);
    cl = column(L);
  }
  const X = MONEY_HALF;
  const set = (ids: string[], col: ReturnType<typeof column>, x: number, side: LabelPos, cap: number) => {
    const pins: Pin[] = ids.map((id) => ({
      id,
      x,
      y: col.ys.get(id)!,
      size: sizeOf(id, cap) * col.fit,
      side,
      chars: g.getNodeAttribute(id, "label").length,
      weight: dollars(id),
    }));
    for (const p of pins)
      g.mergeNodeAttributes(p.id, { mx: x, my: p.y, malpha: 1, msize: p.size, mlabel: side, mweight: p.weight });
  };
  set(L, cl, -X, "left", 13);
  set(R, cr, X, "right", 13);

  const placed = new Set([...L, ...R]);
  const ties: [string, number][] = [];
  g.forEachEdge((k, e, src, dst) => {
    if (e.kind !== "traded" && e.kind !== "funded") return;
    if (placed.has(src) && placed.has(dst)) ties.push([k, e.mshare]);
    else g.setEdgeAttribute(k, "mbase", 0);
  });
  ties.sort((a, b) => b[1] - a[1]);
  for (const [k] of ties.slice(MONEY_TIES)) g.mergeEdgeAttributes(k, { mbase: 0.06, mwidth: 0.5 });
}

export const VIEW_ATTRS = {
  map: { x: "rx", y: "ry", size: "rsize", alpha: "ralpha" },
  money: { x: "mx", y: "my", size: "msize", alpha: "malpha" },
} as const;

export function targetsFor(g: Graph<NodeAttrs, EdgeAttrs>, view: "map" | "money") {
  const k = VIEW_ATTRS[view];
  const out: Record<string, Record<string, number>> = {};
  g.forEachNode((n, a) => {
    const alpha = a[k.alpha];
    out[n] = {
      x: alpha ? a[k.x] : a.x,
      y: alpha ? -a[k.y] : a.y,
      size: alpha ? a[k.size] : a.size * 0.6,
      alpha,
    };
  });
  return out;
}
