import { type Dot, niceMax, spread } from "./derive.ts";
import { usd } from "./format.ts";

export interface Frame {
  w: number;
  h: number;
  l: number;
  r: number;
  t: number;
  b: number;
}

export const frameFor = (w: number): Frame => {
  const phone = w < 560;
  return { w, h: phone ? 360 : 496, l: phone ? 52 : 64, r: phone ? 14 : 16, t: phone ? 62 : 70, b: phone ? 46 : 52 };
};

export interface Placed extends Dot {
  cx: number;
  cy: number;
  r: number;
}

export interface Scale {
  x: (hits: number) => number;
  y: (musd: number) => number;
  xmax: number;
  xticks: number[];
  yticks: { musd: number; label: string }[];
  lo: number;
  hi: number;
}

export function scales(points: Dot[], f: Frame): Scale {
  const hitsMax = Math.max(5, ...points.map((p) => p.hits));
  const xmax = niceMax(hitsMax + 1);
  const mags = points.map((p) => Math.abs(p.musd));
  const lo = Math.max(2, Math.floor(Math.log10(Math.min(...mags, 1000))));
  const hi = Math.max(lo + 2, Math.log10(Math.max(...mags, 1000)) + 0.1);
  const pw = f.w - f.l - f.r;
  const ph = f.h - f.t - f.b;
  const step = xmax <= 40 ? 5 : xmax <= 100 ? 10 : 25;
  const xticks = Array.from({ length: Math.floor(xmax / step) + 1 }, (_, i) => i * step);
  const yticks = Array.from({ length: Math.floor(hi) - lo + 1 }, (_, i) => 10 ** (lo + i)).map((musd) => ({
    musd,
    label: usd(musd * 1e6),
  }));
  return {
    x: (hits) => f.l + 10 + (hits / xmax) * (pw - 10),
    y: (musd) => f.t + ph - ((Math.log10(Math.max(Math.abs(musd), 10 ** lo)) - lo) / (hi - lo)) * ph,
    xmax,
    xticks,
    yticks,
    lo,
    hi,
  };
}

export const radius = (k: Dot["kind"]) => (k === "buried" ? 7.5 : k === "headline" ? 5.5 : 4);

export function place(points: Dot[], f: Frame, s: Scale): Placed[] {
  const out = points.map((p) => {
    const jitter = p.hits === 0 ? spread(p.v.s.id) * 8 + 1 : p.hits < 3 ? spread(p.v.s.id) * 2.5 : 0;
    return { ...p, cx: s.x(p.hits) + jitter, cy: s.y(p.musd), r: radius(p.kind) };
  });
  const order = { normal: 0, headline: 1, buried: 2 } as const;
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
}

export interface Note {
  p: Placed;
  lines: [string, string];
  x: number;
  y: number;
  anchor: "start" | "end";
  lead: boolean;
  tone: "flare" | "iris" | "ink";
}

const CHAR = 6.4;

export function notes(placed: Placed[], f: Frame, zone: { x: number; y: number } | null): Note[] {
  const picks: { p: Placed; tone: Note["tone"]; extra: string }[] = [];
  const add = (p: Placed | undefined, tone: Note["tone"], extra: string) => {
    if (p && !picks.some((k) => k.p === p)) picks.push({ p, tone, extra });
  };
  const by = (k: Dot["kind"]) => placed.filter((p) => p.kind === k);
  const flagged = by("buried").sort((a, b) => Math.abs(b.musd) - Math.abs(a.musd));
  const loud = by("headline").sort((a, b) => b.hits - a.hits);
  const big = [...placed].sort((a, b) => Math.abs(b.musd) - Math.abs(a.musd));
  const phone = f.w < 560;
  for (const p of flagged.slice(0, phone ? 1 : 2))
    add(p, "flare", `${p.hits} ${p.hits === 1 ? "article" : "articles"}${p.v.s.late ? ", added late" : ""}`);
  add(loud[0], "iris", `${loud[0]?.hits} articles, the most of any section`);
  if (!phone)
    add(
      big.find((p) => p.kind !== "buried"),
      "ink",
      "the largest figure",
    );
  const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const hit = (b: (typeof boxes)[number], pad: number) =>
    boxes.some((k) => b.x0 < k.x1 + pad && b.x1 > k.x0 - pad && b.y0 < k.y1 + pad && b.y1 > k.y0 - pad);
  const dotBoxes = placed.map((p) => ({ x0: p.cx - p.r, x1: p.cx + p.r, y0: p.cy - p.r, y1: p.cy + p.r }));
  const hitDot = (b: (typeof boxes)[number]) =>
    dotBoxes.some((k) => b.x0 < k.x1 + 4 && b.x1 > k.x0 - 4 && b.y0 < k.y1 + 4 && b.y1 > k.y0 - 4);
  const out: Note[] = [];
  for (const { p, tone, extra } of picks) {
    const sign = p.musd >= 0 ? "+" : "−";
    const lines: [string, string] = [`§${p.v.s.num}, ${sign}${usd(Math.abs(p.musd) * 1e6)}`, extra];
    const w = Math.max(...lines.map((l) => l.length)) * CHAR;
    let best: { d: number; x: number; y: number; anchor: "start" | "end"; box: (typeof boxes)[number] } | null = null;
    for (let rad = 16; rad <= 150; rad += 8)
      for (let a = 0; a < 360; a += 15) {
        const dx = Math.cos((a * Math.PI) / 180) * rad;
        const dy = Math.sin((a * Math.PI) / 180) * rad;
        const anchor: "start" | "end" = dx >= 0 ? "start" : "end";
        const x = p.cx + dx + (anchor === "start" ? 4 : -4);
        const y = p.cy + dy;
        const box = { x0: anchor === "start" ? x : x - w, x1: anchor === "start" ? x + w : x, y0: y - 12, y1: y + 22 };
        if (box.x0 < f.l + 2 || box.x1 > f.w - 4 || box.y0 < 6 || box.y1 > f.h - f.b - 6) continue;
        if (zone && box.x0 < zone.x + 2 && box.y1 > f.t && box.y0 < zone.y + 6 && p.kind !== "buried") continue;
        if (hit(box, 4) || hitDot(box)) continue;
        const cross = out.some((o) => segmentHitsBox(p.cx, p.cy, x, y, o.p === p ? null : boxOf(o, w)));
        if (cross) continue;
        const d = rad + (Math.abs(dx) < 4 ? 8 : 0);
        if (!best || d < best.d) best = { d, x, y, anchor, box };
      }
    if (!best) continue;
    boxes.push(best.box);
    out.push({ p, lines, x: best.x, y: best.y, anchor: best.anchor, lead: best.d > 20, tone });
  }
  return out;
}

const boxOf = (n: Note, _w: number) => {
  const w = Math.max(...n.lines.map((l) => l.length)) * CHAR;
  return {
    x0: n.anchor === "start" ? n.x : n.x - w,
    x1: n.anchor === "start" ? n.x + w : n.x,
    y0: n.y - 12,
    y1: n.y + 22,
  };
};

function segmentHitsBox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  b: { x0: number; x1: number; y0: number; y1: number } | null,
) {
  if (!b) return false;
  for (let t = 0; t <= 1; t += 0.1) {
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1) return true;
  }
  return false;
}
