import { pt, R } from "./polar.ts";

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Label {
  id: string;
  text: string;
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  box: Box;
}

export const VIEW = { x: -60, y: -20, w: 840, h: 760 };

const WIDTH = 0.58;

export const textWidth = (s: string, size: number) => s.length * size * WIDTH;

function boxOf(x: number, baseline: number, anchor: Label["anchor"], text: string, size: number): Box {
  const w = textWidth(text, size);
  const x0 = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
  return { x0, x1: x0 + w, y0: baseline - size * 0.82, y1: baseline + size * 0.28 };
}

/** A label just outside a ring at `angle`, left-aligned on the right half and right-aligned on the left. */
export function outside(id: string, text: string, angle: number, r: number, size: number): Label {
  const [x, y] = pt(angle, r);
  const c = Math.cos(angle);
  const anchor = c > 0.2 ? "start" : c < -0.2 ? "end" : "middle";
  const dy = Math.abs(c) > 0.2 ? size * 0.33 : Math.sin(angle) < 0 ? -size * 0.33 : size * 1.1;
  return { id, text, x, y: y + dy, anchor, box: boxOf(x, y + dy, anchor, text, size) };
}

/** A label just inside a ring, text running toward the centre on each side. */
export function inside(id: string, text: string, angle: number, r: number, size: number): Label {
  const [x, y] = pt(angle, r);
  const c = Math.cos(angle);
  const anchor = c > 0.3 ? "end" : c < -0.3 ? "start" : "middle";
  const dy = size * 0.33;
  return { id, text, x, y: y + dy, anchor, box: boxOf(x, y + dy, anchor, text, size) };
}

const overlap = (a: Box, b: Box, pad: number) =>
  a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad;

const inView = (b: Box, pad = 4) =>
  b.x0 >= VIEW.x + pad && b.x1 <= VIEW.x + VIEW.w - pad && b.y0 >= VIEW.y + pad && b.y1 <= VIEW.y + VIEW.h - pad;

/** In priority order, keep each label that stays inside the picture and clears every box already kept. */
export function fit(candidates: Label[], avoid: Box[], max: number, pad: number): Label[] {
  const kept: Label[] = [];
  const boxes = [...avoid];
  for (const c of candidates) {
    if (kept.length >= max) break;
    if (!inView(c.box) || boxes.some((b) => overlap(c.box, b, pad))) continue;
    kept.push(c);
    boxes.push(c.box);
  }
  return kept;
}

export const RING_NAME_Y = (r: number) => 360 + r + 4;

export const ringNameBox = (text: string, r: number, size: number): Box => {
  const w = textWidth(text, size);
  const y = RING_NAME_Y(r);
  return { x0: 360 - w / 2, x1: 360 + w / 2, y0: y - size * 0.82, y1: y + size * 0.28 };
};

export const RING_NAMES: Record<"trades" | "pac", [string, string, string]> = {
  trades: ["Sections", "Companies", "Members who traded"],
  pac: ["Sections", "Companies whose PACs gave", "Members who got PAC money"],
};

export const NAME_RADII = [R.ticks + 14, R.company, R.member] as const;
