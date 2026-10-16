export interface SpringSpec {
  zeta: number;
  response: number;
}

export const SWITCH_SPRING: SpringSpec = { zeta: 1, response: 0.4 };
export const CARD_SPRING: SpringSpec = { zeta: 1, response: 0.35 };
export const SHEET_SPRING: SpringSpec = { zeta: 0.8, response: 0.3 };

const SETTLED = 0.002;

/** Position and velocity `t` seconds after leaving `x0` with velocity `v0` toward `target`; exact, so retargeting never drifts. */
export function springAt(t: number, x0: number, v0: number, target: number, s: SpringSpec): [number, number] {
  const w = (Math.PI * 2) / s.response;
  const c1 = x0 - target;
  if (s.zeta >= 1) {
    const e = Math.exp(-w * t);
    const c2 = v0 + w * c1;
    return [target + (c1 + c2 * t) * e, (c2 - w * (c1 + c2 * t)) * e];
  }
  const a = s.zeta * w;
  const wd = w * Math.sqrt(1 - s.zeta * s.zeta);
  const c2 = (v0 + a * c1) / wd;
  const e = Math.exp(-a * t);
  const cos = Math.cos(wd * t);
  const sin = Math.sin(wd * t);
  return [target + e * (c1 * cos + c2 * sin), e * ((c2 * wd - a * c1) * cos - (c1 * wd + a * c2) * sin)];
}

export function springDone(x: number, v: number, target: number, span: number): boolean {
  return Math.abs(x - target) < SETTLED * span && Math.abs(v) < SETTLED * span * 6;
}

/** Seconds until a spring from rest has settled to within 0.5% of its travel. */
export function settleTime(s: SpringSpec): number {
  let t = 0;
  while (t < 4) {
    const [x, v] = springAt(t, 0, 0, 1, s);
    if (Math.abs(1 - x) < 0.005 && Math.abs(v) < 0.02) return t;
    t += 0.01;
  }
  return 4;
}

/** The spring as a CSS `linear()` easing plus the duration it needs, for transitions that stay interruptible. */
export function springEasing(s: SpringSpec, steps = 28): { duration: number; easing: string } {
  const duration = settleTime(s);
  const stops: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const [x] = springAt((i / steps) * duration, 0, 0, 1, s);
    stops.push(i === steps ? "1" : (Math.round(x * 1000) / 1000).toString());
  }
  return { duration: Math.round(duration * 1000), easing: `linear(${stops.join(", ")})` };
}

/** How far a drag past a limit actually moves: it resists more the further you pull, like a scroll view's edge. */
export function rubberBand(overshoot: number, range: number, c = 0.55): number {
  if (overshoot <= 0) return 0;
  return (1 - 1 / ((overshoot * c) / range + 1)) * range;
}

/** Where a flick would come to rest: position plus the distance momentum carries it (velocity in px/s). */
export function project(position: number, velocity: number, decel = 0.998): number {
  return position + ((velocity / 1000) * decel) / (1 - decel);
}

/** The detent nearest to where the sheet is heading. */
export function nearest(points: number[], to: number): number {
  let best = points[0] ?? 0;
  for (const p of points) if (Math.abs(p - to) < Math.abs(best - to)) best = p;
  return best;
}
