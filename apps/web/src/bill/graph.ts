import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
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
const LABELED_ACTORS = 12;

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
  halo: "headline" | "buried" | null;
}

export interface EdgeAttrs {
  kind: DisplayKind;
  tone: Tone;
  inference: boolean;
  width: number;
  base: number;
  curvature: number;
  views: ("map" | "money")[];
}

export type NS = { isActive: boolean; isHovered: boolean };
export type GS = { focused: boolean; tick: number };
export type Renderer = Sigma<NodeAttrs, EdgeAttrs, Attributes, { isActive: boolean }, { isActive: boolean }, GS>;

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
  const topActors = new Set(actors.slice(0, LABELED_ACTORS).map((a) => a.id));
  const maxActor = Math.max(2, ((TAU * ar) / (actors.length || 1)) * 0.38);
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
      borderSize: hollow ? 0.2 : 0,
      labelTone: "text",
      rx: p.x,
      ry: p.y,
      rsize: Math.min(maxActor, 3 + Math.sqrt(a.reports) * 0.9 + a.traders.size * 0.15),
      ralpha: 1,
      rlabel: labelSide(ang),
      important: topActors.has(a.id) ? 1 : 0,
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
  const topLabels = new Set(
    [
      ...[...members].sort((x, y) => y.tradeCount - x.tradeCount).slice(0, 4),
      ...[...members].sort((x, y) => y.fundedUsd - x.fundedUsd).slice(0, 2),
      ...members.filter((v) => v.sponsor).slice(0, 2),
    ].map((v) => v.node.id),
  );
  const [m0, m1] = RING.members;
  const mr = (m0 + m1) / 2;
  const maxMember = Math.max(1.6, ((TAU * mr) / (members.length || 1)) * 0.4);
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
      borderSize: v.sponsor || v.inserted.length ? 0.34 : vote === "Yea" ? 0 : 0.26,
      labelTone: "muted",
      rx: p.x,
      ry: p.y,
      rsize: Math.min(maxMember, 3.2 + Math.sqrt(v.tradeCount + v.fundedUsd / 2e4) * 0.75),
      ralpha: 1,
      rlabel: labelSide(ang),
      important: topLabels.has(v.node.id) ? 1 : 0,
    });
  }

  const counts = { lobbied: 0, traded: 0, funded: 0, voted: 0, sponsored: 0, inserted: 0 } as Record<
    DisplayKind,
    number
  >;
  for (const e of m.edges) {
    const src = e.src;
    const dst = e.dst;
    if (!g.hasNode(src) || !g.hasNode(dst) || g.hasEdge(e.id)) continue;
    const toCenter = dst === m.billNode;
    const style: Pick<EdgeAttrs, "tone" | "width" | "base" | "views"> =
      e.kind === "lobbied"
        ? { tone: "violet", width: 0.7, base: 0.28, views: ["map"] }
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
      ...style,
    });
    counts[e.kind]++;
  }

  moneyLayout(g, m);
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

/**
 * Money map: only companies and members joined by trades or PAC money, laid out by force (ForceAtlas2, seeded with
 * the radial positions so it is the same every load), then fitted to the same circle.
 */
function moneyLayout(g: Graph<NodeAttrs, EdgeAttrs>, m: BillModel) {
  const sub = new Graph({ type: "undirected", multi: false });
  g.forEachEdge((key, e, src, dst) => {
    if (e.kind !== "traded" && e.kind !== "funded") return;
    for (const n of [src, dst])
      if (!sub.hasNode(n)) sub.addNode(n, { x: g.getNodeAttribute(n, "rx"), y: g.getNodeAttribute(n, "ry") });
    const w = e.kind === "traded" ? 1 + e.width : 0.4 + e.width * 0.5;
    if (sub.hasEdge(src, dst)) sub.updateEdgeAttribute(src, dst, "weight", (x: number) => x + w);
    else sub.addUndirectedEdgeWithKey(key, src, dst, { weight: w });
  });
  if (!sub.order) return;
  forceAtlas2.assign(sub, {
    iterations: 600,
    getEdgeWeight: "weight",
    settings: {
      ...forceAtlas2.inferSettings(sub),
      linLogMode: true,
      gravity: 1.2,
      scalingRatio: 6,
      adjustSizes: false,
    },
  });
  let cx = 0;
  let cy = 0;
  sub.forEachNode((_n, a) => {
    cx += a.x;
    cy += a.y;
  });
  cx /= sub.order;
  cy /= sub.order;
  let far = 1;
  sub.forEachNode((_n, a) => {
    far = Math.max(far, Math.hypot(a.x - cx, a.y - cy));
  });
  const k = (RADIUS - 40) / far;
  const topMembers = new Set<string>(
    m.members
      .filter((v) => sub.hasNode(v.node.id))
      .sort((x, y) => y.fundedUsd + y.tradeCount * 2e4 - (x.fundedUsd + x.tradeCount * 2e4))
      .slice(0, 10)
      .map((v) => v.node.id),
  );
  sub.forEachNode((n, a) => {
    const x = (a.x - cx) * k;
    const y = (a.y - cy) * k;
    const kind = g.getNodeAttribute(n, "kind");
    const actor = m.actorById.get(n);
    const member = m.memberById.get(n);
    g.mergeNodeAttributes(n, {
      mx: x,
      my: y,
      malpha: 1,
      mlabel: x >= 0 ? "right" : "left",
      msize:
        kind === "actor" && actor
          ? Math.min(16, 4 + Math.sqrt(actor.pacUsd / 2e4 + actor.traders.size * 3))
          : member
            ? Math.min(12, 3 + Math.sqrt(member.fundedUsd / 2e4 + member.tradeCount))
            : 4,
      important: (kind === "actor" && (actor?.traders.size ?? 0) >= 4) || topMembers.has(n) ? 1 : 0,
    });
  });
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
