export interface Pt {
  /** Where the dot's column is centred. */
  cx: number;
  y: number;
  /** The column's walls: the dot stays between them while there is room. */
  lo: number;
  hi: number;
}

/**
 * A beeswarm: every dot keeps its y and sits at the x nearest its column's centre where it touches no dot already
 * placed and stays inside the column's walls (it overlaps its neighbours only when the column is full). Returns each dot's x, in the order given.
 */
export function swarm(pts: Pt[], r: number, gap = 0.6): number[] {
  const d = 2 * r + gap;
  const out = new Array<number>(pts.length);
  const bands = new Map<number, { x: number; y: number }[]>();
  const order = pts.map((_, i) => i).sort((a, b) => pts[a]!.y - pts[b]!.y || a - b);
  for (const i of order) {
    const { cx, y, lo, hi } = pts[i]!;
    const band = Math.floor(y / d);
    const near = [band - 1, band, band + 1].flatMap((k) => bands.get(k) ?? []);
    const blocked = near
      .filter((p) => Math.abs(p.y - y) < d)
      .map((p) => {
        const w = Math.sqrt(d * d - (p.y - y) ** 2);
        return [p.x - w, p.x + w] as const;
      });
    const free = (x: number) => blocked.every(([from, to]) => x <= from + 1e-6 || x >= to - 1e-6);
    const candidates = [cx, ...blocked.flat()]
      .filter((c) => c >= lo && c <= hi)
      .sort((a, b) => Math.abs(a - cx) - Math.abs(b - cx));
    const x = candidates.find(free) ?? Math.min(hi, Math.max(lo, cx));
    out[i] = x;
    bands.set(band, [...(bands.get(band) ?? []), { x, y }]);
  }
  return out;
}

/** `n` dots packed in rows no wider than `width`, centred on `cx`, rising from `base`: for columns with no y to keep. */
export function pile(n: number, cx: number, width: number, base: number, r: number, gap = 0.6): [number, number][] {
  const d = 2 * r + gap;
  const per = Math.max(1, Math.floor(width / d));
  return Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / per);
    const inRow = Math.min(per, n - row * per);
    const col = i % per;
    return [cx + (col - (inRow - 1) / 2) * d + (row % 2 ? d / 4 : 0), base - row * d * 0.88] as [number, number];
  });
}
