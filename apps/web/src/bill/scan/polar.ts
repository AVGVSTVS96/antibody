export const TAU = Math.PI * 2;
export const C = 360;

export const R = {
  core: 62,
  ticks: 104,
  bars: 92,
  groupArc: 82,
  guides: [170, 250, 330] as const,
  company: 250,
  member: 330,
  memberDots: 332,
  track: 268,
  trackEnd: 318,
  companyLabel: 226,
  memberLabel: 346,
  groupLabel: 336,
  barSpan: 220,
  barMin: 8,
};

export const TOP = (3 * Math.PI) / 2;

export const pt = (a: number, r: number): [number, number] => [C + r * Math.cos(a), C + r * Math.sin(a)];

export const wrapPi = (a: number) => {
  const x = (a + Math.PI) % TAU;
  return (x < 0 ? x + TAU : x) - Math.PI;
};

export const wrapTau = (a: number) => {
  const x = a % TAU;
  return x < 0 ? x + TAU : x;
};

const f = (n: number) => (Math.round(n * 10) / 10).toString();

export const fmt = (p: [number, number]) => `${f(p[0])} ${f(p[1])}`;

/** Where slot `i` of `n` sits on a ring that leaves `gap` radians open at the bottom, going clockwise from just after the gap. */
export const slotAngle = (i: number, n: number, gap: number) => Math.PI / 2 + gap / 2 + ((i + 0.5) / n) * (TAU - gap);

/** The same slots, rotated so the first item sits at 12 o'clock and the rest follow clockwise. */
export const fromTop = (i: number, n: number, gap: number) => slotAngle((i + (n >> 1)) % n, n, gap);

/** Clockwise distance from 12 o'clock, so sorting by it walks the ring the way a reader's eye does. */
export const clockwiseFromTop = (a: number) => wrapTau(a - TOP);
