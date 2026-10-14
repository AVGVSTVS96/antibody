import { memo, useMemo, useRef, useState } from "react";
import { count, usd } from "../lib/format.ts";
import { scaleLabel, type Tape, type TapeRow } from "../lib/tape.ts";
import { useWidth } from "../ui/useWidth.ts";
import { signed } from "./derive.ts";
import { hover } from "./store.ts";
import { pile, swarm } from "./swarm.ts";

interface Dot {
  row: TapeRow;
  x: number;
  y: number;
}

interface Plot {
  dots: Dot[];
  r: number;
  height: number;
  left: number;
  divider: number;
  axisY: number;
  yTicks: { y: number; label: string }[];
  xTicks: { x: number; label: string }[];
  shelfLabel: number | null;
}

const kindOf = (r: TapeRow) => (r.kind === "headline" ? "loud" : r.kind === "quiet" ? "quiet" : "other");

/** Article counts to label: all of them when few, else the multiples of an even step (1, 2 or 5 times a power of ten) that give at most seven, ending on the largest. */
export function xTicks(max: number): number[] {
  if (max <= 6) return Array.from({ length: max }, (_, i) => i + 1);
  const base = 10 ** Math.floor(Math.log10(max / 7));
  const step = [1, 2, 5, 10].map((k) => k * base).find((k) => max / k <= 7)!;
  const mid = Array.from({ length: Math.floor(max / step) }, (_, i) => (i + 1) * step).filter(
    (n) => n > 1 && n <= max - step / 2,
  );
  return [1, ...mid, max];
}

function plotOf(tape: Tape, width: number, compact: boolean): Plot {
  const measured = tape.rows.filter((r) => r.articles != null);
  const n = measured.length;
  const r = n < 60 ? 5 : compact ? (n > 900 ? 2.2 : n > 350 ? 2.5 : 3) : n > 900 ? 2.2 : n > 350 ? 2.8 : 3.4;
  const left = compact ? 44 : 58;
  const top = 34;
  const bottom = 26;
  const zero = Math.min(200, Math.max(80, (width - left) * 0.28));
  const divider = left + zero;
  const max = Math.max(1, ...measured.map((m) => m.articles!));
  const x1 = divider + (compact ? 14 : 18);
  const step = max > 1 ? Math.min(40, (width - 12 - x1) / (max - 1)) : 0;
  const colX = (hits: number) => (hits === 0 ? left + zero / 2 : x1 + (hits - 1) * step);
  const xs = xTicks(max).map((h) => ({ x: colX(h), label: String(h) }));
  xs.unshift({ x: colX(0), label: "0" });
  const d = 2 * r + 0.6;
  const per = (cw: number) => Math.max(1, Math.floor(cw / d));
  const colWidth = (hits: number) => (hits === 0 ? zero - 8 : Math.max(step, d));

  const pileOf = (rows: TapeRow[], base: (rowsNeeded: number) => number): Dot[] => {
    const cols = Map.groupBy(rows, (m) => m.articles!);
    const need = Math.max(1, ...[...cols].map(([h, c]) => Math.ceil(c.length / per(colWidth(h)))));
    const y0 = base(need);
    return [...cols].flatMap(([h, c]) =>
      pile(c.length, colX(h), colWidth(h), y0, r).map(([x, y], i) => ({ row: c[i]!, x, y })),
    );
  };

  const figured = measured.filter((m) => m.musd != null);
  if (tape.flat) {
    const height = (need: number) => top + Math.max(56, need * d * 0.88 + 2 * r + 8);
    let h = 0;
    const dots = pileOf(measured, (need) => {
      h = height(need);
      return h - r - 2;
    });
    return {
      dots,
      r,
      height: h + bottom,
      left,
      divider,
      axisY: h,
      yTicks: [],
      xTicks: xs,
      shelfLabel: null,
    };
  }

  const abs = figured.map((m) => Math.max(Math.abs(m.musd!), 10));
  const loExp = 1;
  const hiExp = Math.max(Math.ceil(Math.log10(Math.max(...abs, 10))), loExp + 3);
  const plotH = compact ? 220 : 300;
  const yOf = (m: number) => top + plotH * (1 - (Math.log10(Math.max(Math.abs(m), 10)) - loExp) / (hiExp - loExp));
  const axisY = top + plotH;
  const xsOf = swarm(
    figured.map((m) => ({
      cx: colX(m.articles!),
      y: yOf(m.musd!),
      lo: m.articles ? divider + r : left + r,
      hi: m.articles ? width - r : divider - r,
    })),
    r,
  );
  const dots = figured.map((m, i): Dot => ({ row: m, x: xsOf[i]!, y: yOf(m.musd!) }));
  const unfigured = measured.filter((m) => m.musd == null);
  let shelf = 0;
  if (unfigured.length) {
    let base = 0;
    dots.push(
      ...pileOf(unfigured, (need) => {
        shelf = need * d * 0.88 + 2 * r + 6;
        base = axisY + 22 + (need - 1) * d * 0.88 + r;
        return base;
      }),
    );
  }
  const yTicks = Array.from({ length: hiExp - loExp + 1 }, (_, i) => {
    const m = 10 ** (loExp + i);
    return { y: yOf(m), label: scaleLabel(m) };
  });
  return {
    dots,
    r,
    height: axisY + (shelf ? shelf + 26 : 0) + bottom,
    left,
    divider,
    axisY,
    yTicks,
    xTicks: xs,
    shelfLabel: shelf ? axisY + 16 : null,
  };
}

const DotLayer = memo(function DotLayer({ dots, r }: { dots: Dot[]; r: number }) {
  const order = ["other", "loud", "quiet"] as const;
  return (
    <>
      {order.map((kind) => (
        <g key={kind}>
          {dots.map(
            (d, i) =>
              kindOf(d.row) === kind && (
                <circle
                  key={d.row.id}
                  className={`x-dot x-dot-${kind}`}
                  data-cut={(d.row.musd ?? 0) < 0 || undefined}
                  data-i={i}
                  cx={d.x}
                  cy={d.y}
                  r={r}
                />
              ),
          )}
        </g>
      ))}
      <path
        className="x-dot-split"
        d={dots
          .filter((d) => d.row.evenSplit)
          .map(
            (d) =>
              `M${d.x - r - 2} ${d.y}a${r + 2} ${r + 2} 0 1 0 ${2 * (r + 2)} 0a${r + 2} ${r + 2} 0 1 0 -${2 * (r + 2)} 0`,
          )
          .join("")}
      />
    </>
  );
});

function Lifted({ dots }: { dots: Dot[] }) {
  const id = hover.use();
  const d = id && dots.find((x) => x.row.id === id);
  if (!d) return null;
  return (
    <circle
      key={id}
      className={`x-dot x-dot-${kindOf(d.row)} x-dot-lift`}
      data-cut={(d.row.musd ?? 0) < 0 || undefined}
      cx={d.x}
      cy={d.y}
      r={10}
    />
  );
}

export function quietNote(tape: Tape): string | null {
  const q = tape.rows.filter((r) => r.kind === "quiet");
  if (!q.length) return null;
  const figured = q.filter((r) => r.musd != null);
  const abs = figured.map((r) => Math.abs(r.musd!));
  const adds = figured.filter((r) => r.musd! > 0).length;
  const cuts = figured.length - adds;
  const late = q.filter((r) => r.late).length;
  const short = (m: number) => usd(m * 1e6);
  return [
    [adds && `${adds} add`, cuts && `${cuts} cut`].filter(Boolean).join(", "),
    abs.length &&
      `${short(Math.min(...abs))}${Math.min(...abs) === Math.max(...abs) ? "" : ` to ${short(Math.max(...abs))}`} each`,
    q.length > figured.length && `${q.length - figured.length} with no CBO figure`,
    tape.lateKnown && (late === q.length ? "all added late" : `${late} of ${q.length} added late`),
  ]
    .filter(Boolean)
    .join(", ")
    .concat(".");
}

export function Chart({ tape, period, onGo }: { tape: Tape; period: string | null; onGo: (id: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const compact = width > 0 && width < 560;
  const plot = useMemo(() => (width ? plotOf(tape, width, compact) : null), [tape, width, compact]);
  const [tip, setTip] = useState<Dot | null>(null);
  const pick = (e: React.PointerEvent): Dot | null => {
    const i = (e.target as SVGElement).dataset?.i;
    return i == null ? null : (plot!.dots[+i] ?? null);
  };
  const move = (e: React.PointerEvent) => {
    const d = pick(e);
    setTip(d);
    hover.set(d?.row.id ?? null);
  };
  const leave = () => {
    setTip(null);
    hover.set(null);
  };

  return (
    <div className="x-chart-frame">
      <div className="x-chart" ref={box}>
        {plot && (
          <>
            <svg
              width={width}
              height={plot.height}
              role="img"
              aria-label={`Each dot is one section: ${tape.flat ? "placed by" : "cost against"} the number of news articles matching it. The list below has the same sections.`}
              onPointerMove={move}
              onPointerLeave={leave}
              onPointerUp={(e) => {
                const d = e.button === 0 ? pick(e) : null;
                if (d) onGo(d.row.id);
              }}
            >
              {plot.yTicks.map((t) => (
                <g key={t.label}>
                  <line className="x-grid" x1={plot.left} x2={width} y1={t.y} y2={t.y} />
                  <text className="x-tick" x={plot.left - 8} y={t.y + 4} textAnchor="end">
                    {t.label}
                  </text>
                </g>
              ))}
              <line className="x-axis" x1={plot.left} x2={width} y1={plot.axisY} y2={plot.axisY} />
              <line className="x-divider" x1={plot.divider} x2={plot.divider} y1={24} y2={plot.axisY} />
              {plot.xTicks.map((t) => (
                <text
                  key={t.label}
                  className="x-tick"
                  data-bold={t.label === "0" || undefined}
                  x={t.x}
                  y={plot.height - 8}
                  textAnchor="middle"
                >
                  {t.label}
                </text>
              ))}
              {plot.shelfLabel != null && (
                <text className="x-tick" x={plot.left - 8} y={plot.shelfLabel} textAnchor="end">
                  <tspan x={plot.left - 8}>NO CBO</tspan>
                  <tspan x={plot.left - 8} dy="11">
                    FIGURE
                  </tspan>
                </text>
              )}
              <DotLayer dots={plot.dots} r={plot.r} />
              <Lifted dots={plot.dots} />
            </svg>
            {!tape.flat && (
              <p className="x-chart-title">CBO COST OF THE SECTION, {(period ?? "").replace("-", "–")}, LOG SCALE ↑</p>
            )}
            <p className="x-chart-x">
              <b>NO ARTICLE</b>
              <span>NEWS ARTICLES THAT MATCH THE SECTION (OF {tape.read.toLocaleString("en-US")} READ) →</span>
            </p>
            {tip && (
              <div
                className="x-tip"
                style={{
                  left: Math.min(Math.max(tip.x + 14, 4), width - 232),
                  top: Math.min(Math.max(tip.y - 30, 24), plot.height - 110),
                }}
              >
                <p>
                  {tip.row.label}
                  {tip.row.place[0] ? ` · ${tip.row.place[0]}` : ""}
                </p>
                <b>{tip.row.heading}</b>
                <p>
                  {tip.row.musd == null ? "No CBO figure" : signed(tip.row.musd)}
                  {tip.row.evenSplit ? " (even split)" : ""} · {count(tip.row.articles ?? 0, "article")}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
