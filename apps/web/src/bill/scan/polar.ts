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

export const slotAngle = (i: number, n: number, gap: number) => Math.PI / 2 + gap / 2 + ((i + 0.5) / n) * (TAU - gap);

export const fromTop = (i: number, n: number, gap: number) => slotAngle((i + Math.floor(n / 2)) % n, n, gap);

export const clockwiseFromTop = (a: number) => wrapTau(a - TOP);
