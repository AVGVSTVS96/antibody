import type { BillModel, SectionView } from "../../lib/model.ts";
import { type DollarScale, dollarScale } from "./dollars.ts";
import { groupSections, type SectionGroup } from "./groups.ts";
import { clockwiseFromTop, fromTop, R, slotAngle, TAU, wrapPi, wrapTau } from "./polar.ts";
import { pacTies, type RingData, type RingView, selectRing, type Tie, tradeTies } from "./select.ts";

export type MapView = RingView | "sections";

export const GAP = { ring: (16 * Math.PI) / 180, bars: (30 * Math.PI) / 180 };
const GROUP_GAP = (3.2 * Math.PI) / 180;
const GROUP_GAP_BUDGET = (60 * Math.PI) / 180;

export interface Slot {
  id: string;
  angle: number;
  size: number;
}

export interface RingLayout {
  view: RingView;
  gap: number;
  /** Clockwise from 12 o'clock, the order arrow keys walk. */
  companies: Slot[];
  members: Slot[];
  company: Map<string, Slot>;
  member: Map<string, Slot>;
}

/** Slots go in rank order from 12 o'clock; each item's angle is where it wants to sit, evened out over the free arc. */
export function placeByWant(wants: number[], gap: number): number[] {
  const n = wants.length;
  if (!n) return [];
  const start = Math.PI / 2 + gap / 2;
  const order = wants.map((w, i) => ({ w: wrapTau(w - start) + start, i })).sort((a, b) => a.w - b.w || a.i - b.i);
  const slots = Array.from({ length: n }, (_, k) => slotAngle(k, n, gap));
  let best = 0;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let s = 0; s < n; s++) {
    let cost = 0;
    for (let j = 0; j < n; j++) {
      const d = wrapPi(slots[(j + s) % n]! - order[j]!.w);
      cost += d * d;
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = s;
    }
  }
  const out = new Array<number>(n);
  for (let j = 0; j < n; j++) out[order[j]!.i] = slots[(j + best) % n]!;
  return out;
}

export function layoutRing(data: RingData): RingLayout {
  const gap = GAP.ring;
  const nC = data.companies.length;
  const nM = data.members.length;
  const coSpacing = (R.company * (TAU - gap)) / Math.max(nC, 1);
  const memSpacing = (R.member * (TAU - gap)) / Math.max(nM, 1);
  const maxCo = Math.max(...data.companyWeight.values(), 1);
  const maxMem = Math.max(...data.memberWeight.values(), 1);

  const companies = data.companies.map<Slot>((a, i) => {
    const w = data.companyWeight.get(a.id) ?? 0;
    const side = data.view === "trades" ? 7 + (Math.min(w, 30) / 30) * 7 : 6 + Math.sqrt(w / maxCo) * 12;
    return { id: a.id, angle: fromTop(i, nC, gap), size: Math.max(4, Math.min(side, coSpacing * 0.8)) };
  });
  const coAngle = new Map(companies.map((c) => [c.id, c.angle]));

  const wants = data.members.map((v) => {
    let x = 0;
    let y = 0;
    let heaviest: number | null = null;
    let top = -1;
    for (const t of data.byMember.get(v.node.id) ?? []) {
      const a = coAngle.get(t.company);
      if (a == null) continue;
      const w = data.view === "trades" ? t.weight : Math.sqrt(t.weight);
      x += Math.cos(a) * w;
      y += Math.sin(a) * w;
      if (w > top) {
        top = w;
        heaviest = a;
      }
    }
    return Math.hypot(x, y) > 1e-6 * Math.max(top, 1) ? Math.atan2(y, x) : (heaviest ?? Math.PI / 2);
  });
  const angles = placeByWant(wants, gap);
  const members = data.members.map<Slot>((v, i) => {
    const w = data.memberWeight.get(v.node.id) ?? 0;
    const r = data.view === "trades" ? 2.4 + Math.sqrt(Math.min(w, 240) / 240) * 5.4 : 1.2 + Math.sqrt(w / maxMem) * 3;
    return {
      id: v.node.id,
      angle: angles[i]!,
      size: Math.max(0.9, Math.min(r, memSpacing * (data.view === "trades" ? 0.45 : 0.5))),
    };
  });

  const byClock = (a: Slot, b: Slot) => clockwiseFromTop(a.angle) - clockwiseFromTop(b.angle);
  const sortedCo = [...companies].sort(byClock);
  const sortedMem = [...members].sort(byClock);
  return {
    view: data.view,
    gap,
    companies: sortedCo,
    members: sortedMem,
    company: new Map(companies.map((s) => [s.id, s])),
    member: new Map(members.map((s) => [s.id, s])),
  };
}

export type Tone = "cost" | "save" | "stub";
export type Level = "headline" | "buried" | "normal";

export interface SectionMark {
  id: string;
  v: SectionView;
  group: number;
  level: Level;
  tone: Tone;
  estimate: boolean;
  bucket: string;
}

export interface BarsLayout {
  gap: number;
  scale: DollarScale | null;
  groups: { group: SectionGroup; start: number; end: number; mid: number }[];
  angle: number[];
  length: number[];
}

const levelOf = (v: SectionView): Level => (v.kind === "headline" || v.kind === "buried" ? v.kind : "normal");

export function sectionMarks(groups: SectionGroup[]): SectionMark[] {
  return groups.flatMap((group, gi) =>
    group.sections.map<SectionMark>((v) => {
      const level = levelOf(v);
      const tone: Tone = v.dollarsMusd == null ? "stub" : v.dollarsMusd < 0 ? "save" : "cost";
      const estimate = tone !== "stub" && v.s.score?.components.dollarsSplit === "even_split";
      return {
        id: `section:${v.s.id}`,
        v,
        group: gi,
        level,
        tone,
        estimate,
        bucket: `${level}-${tone}${estimate ? "-est" : ""}`,
      };
    }),
  );
}

export function layoutBars(groups: SectionGroup[], marks: SectionMark[]): BarsLayout {
  const n = marks.length;
  const scale = dollarScale(marks.map((x) => x.v.dollarsMusd));
  const gg = Math.min(GROUP_GAP, GROUP_GAP_BUDGET / Math.max(groups.length, 1));
  const step = (TAU - GAP.bars - gg * Math.max(groups.length - 1, 0)) / Math.max(n, 1);
  let a = Math.PI / 2 + GAP.bars / 2;
  const angle: number[] = [];
  const spans: BarsLayout["groups"] = [];
  for (const group of groups) {
    const start = a;
    for (let i = 0; i < group.sections.length; i++) {
      angle.push(a + step / 2);
      a += step;
    }
    spans.push({ group, start, end: a, mid: (start + a) / 2 });
    a += gg;
  }
  return {
    gap: GAP.bars,
    scale,
    groups: spans,
    angle,
    length: marks.map((x) => (scale ? scale.length(x.v.dollarsMusd) : R.barMin)),
  };
}

export const TICK_LENGTH: Record<Level, number> = { normal: 14, headline: 22, buried: 30 };

export function tickAngles(n: number): number[] {
  return Array.from({ length: n }, (_, i) => slotAngle(i, n, GAP.ring));
}

const TICK_WIDTH: Record<Level, number> = { normal: 2.2, headline: 3.2, buried: 3.4 };
const BAR_WIDTH: Record<Level, number> = { normal: 2.6, headline: 2.6, buried: 3.6 };

/** Stroke width that keeps neighbours apart: the design's width up to the room each tick has. */
export function strokeWidths(n: number, view: MapView): Record<Level, number> {
  const base = view === "sections" ? BAR_WIDTH : TICK_WIDTH;
  const room =
    ((TAU - (view === "sections" ? GAP.bars : GAP.ring)) * (view === "sections" ? 150 : R.ticks)) / Math.max(n, 1);
  const cap = Math.max(0.5, room * 0.72);
  return {
    normal: Math.min(base.normal, cap),
    headline: Math.min(base.headline, cap * 1.3),
    buried: Math.min(base.buried, cap * 1.5),
  };
}

export const CHANNELS = 5;
export const CH = { angle: 0, r0: 1, r1: 2, size: 3, alpha: 4 } as const;

export interface MarkDef {
  id: string;
  kind: "section" | "company" | "member";
  bucket: string;
}

export interface SceneTargets {
  present: Uint8Array;
  t: Float64Array;
}

export interface Scenes {
  m: BillModel;
  marks: MarkDef[];
  index: Map<string, number>;
  sections: SectionMark[];
  groups: SectionGroup[];
  bars: BarsLayout;
  tickAngle: number[];
  ring: Record<RingView, { data: RingData; layout: RingLayout }>;
  /** Every tie of each company, drawn or not, so a card can list all of them. */
  allTies: Record<RingView, Map<string, Tie[]>>;
  targets: Record<MapView, SceneTargets>;
  finalSections: number;
  figures: number;
}

function byCompany(ties: Tie[]): Map<string, Tie[]> {
  const out = new Map<string, Tie[]>();
  for (const t of ties) out.set(t.company, [...(out.get(t.company) ?? []), t]);
  return out;
}

/** The ids arrow keys walk, in reading order: companies clockwise from the top, or titles in bill order. */
export function itemIds(s: Scenes, view: MapView): string[] {
  return view === "sections" ? s.bars.groups.map((g) => g.group.id) : s.ring[view].layout.companies.map((c) => c.id);
}

/** Whether a pinned id has a mark in this view. */
export function present(s: Scenes, view: MapView, id: string): boolean {
  if (id.startsWith("group:")) return view === "sections" && s.bars.groups.some((g) => g.group.id === id);
  const i = s.index.get(id);
  return i != null && s.targets[view].present[i] === 1;
}

export function buildScenes(m: BillModel, must: readonly string[] = []): Scenes {
  const groups = groupSections(m);
  const sections = sectionMarks(groups);
  const bars = layoutBars(groups, sections);
  const tickAngle = tickAngles(sections.length);
  const ring = Object.fromEntries(
    (["trades", "pac"] as const).map((view) => {
      const data = selectRing(m, view, must);
      return [view, { data, layout: layoutRing(data) }];
    }),
  ) as Scenes["ring"];

  const marks: MarkDef[] = sections.map((s) => ({ id: s.id, kind: "section", bucket: s.bucket }));
  const seen = new Set(marks.map((x) => x.id));
  for (const view of ["trades", "pac"] as const) {
    const add = (id: string, kind: MarkDef["kind"]) => {
      if (seen.has(id)) return;
      seen.add(id);
      marks.push({ id, kind, bucket: "" });
    };
    for (const s of ring[view].layout.companies) add(s.id, "company");
    for (const s of ring[view].layout.members) add(s.id, "member");
  }
  const index = new Map(marks.map((x, i) => [x.id, i]));
  const blank = (): SceneTargets => ({
    present: new Uint8Array(marks.length),
    t: new Float64Array(marks.length * CHANNELS),
  });
  const targets = { trades: blank(), pac: blank(), sections: blank() };

  const put = (sc: SceneTargets, id: string, angle: number, r0: number, r1: number, size: number) => {
    const i = index.get(id)!;
    sc.present[i] = 1;
    const o = i * CHANNELS;
    sc.t[o + CH.angle] = angle;
    sc.t[o + CH.r0] = r0;
    sc.t[o + CH.r1] = r1;
    sc.t[o + CH.size] = size;
    sc.t[o + CH.alpha] = 1;
  };
  sections.forEach((s, i) => {
    for (const view of ["trades", "pac"] as const)
      put(targets[view], s.id, tickAngle[i]!, R.ticks, R.ticks + TICK_LENGTH[s.level], 0);
    put(targets.sections, s.id, bars.angle[i]!, R.bars, R.bars + bars.length[i]!, 0);
  });
  for (const view of ["trades", "pac"] as const) {
    const { layout } = ring[view];
    for (const s of layout.companies) put(targets[view], s.id, s.angle, R.company, R.company, s.size);
    for (const s of layout.members)
      put(
        targets[view],
        s.id,
        s.angle,
        view === "trades" ? R.member : R.memberDots,
        view === "trades" ? R.member : R.memberDots,
        s.size,
      );
  }
  return {
    m,
    marks,
    index,
    sections,
    groups,
    bars,
    tickAngle,
    ring,
    allTies: { trades: byCompany(tradeTies(m)), pac: byCompany(pacTies(m)) },
    targets,
    finalSections: sections.length,
    figures: sections.filter((x) => x.tone !== "stub").length,
  };
}

export interface Emptiness {
  trades: string | null;
  pac: string | null;
  sections: string | null;
}

/** Why a view has nothing to show, in plain words, or null when it has something. */
export function emptiness(s: Scenes): Emptiness {
  const gap = s.m.b.gaps.find((g) => g.kind === "no_section_dollars");
  return {
    trades: s.ring.trades.data.companies.length ? null : "No stock trades tied to this bill’s companies.",
    pac: s.ring.pac.data.companies.length
      ? null
      : "No PAC money from this bill’s companies reached members before the vote.",
    sections: s.figures ? null : (gap?.text ?? "CBO gave no figure for any section of this bill."),
  };
}
