import { type KeyboardEvent, memo, type PointerEvent, type ReactNode, useMemo, useRef, useState } from "react";
import { count, musd } from "../lib/format.ts";
import {
  type Geometry,
  geometry,
  indexAt,
  layout,
  logHeight,
  type Mark,
  quietRun,
  REFERENCES,
  runNote,
  slot,
  type Tape as TapeData,
  type TapeMark,
} from "../lib/tape.ts";
import { useWidth } from "./useWidth.ts";
import "./tape.css";

const COMPACT_BELOW = 640;
const KIND_NAME = { headline: "Headline", quiet: "Quiet and costly", other: "" } as const;

export interface TapeProps<R extends TapeMark> {
  tape: TapeData<R>;
  /** A mark was clicked, tapped, lifted from after a drag, or chosen with Enter. */
  onSelect?: (row: R) => void;
  /** Section id: draws the blue "you are here" marker on it. */
  current?: string;
  currentLabel?: string;
  /** Section ids to light: every other mark fades to 18% and the lit ones sit on a yellow column. */
  highlight?: ReadonlySet<string>;
  /** Sticks under the top bar while the page scrolls (`--top-h` is the bar's height). */
  pinned?: boolean;
  /** The mono line above the tape, left of the legend. */
  caption?: ReactNode;
  legend?: boolean;
  /** Title or division labels under the marks. On by default except on a phone. */
  axis?: boolean;
  /** Names the densest run of yellow marks under the axis, worked out from the marks. */
  note?: boolean;
}

const rect = (m: Mark) => `M${m.x} ${m.y}h${m.w}v${m.h}h-${m.w}z`;
const dashedRect = (m: Mark) => `M${m.x - 0.5} ${m.y - 0.5}h${m.w + 1}v${m.h + 1}h-${m.w + 1}z`;

function pathsOf(rows: TapeMark[], marks: Mark[], g: Geometry) {
  const d = { stub: "", other: "", loud: "", quiet: "", late: "", split: "" };
  for (const r of rows) {
    const m = marks[r.index]!;
    d[m.stub ? "stub" : r.kind === "headline" ? "loud" : r.kind === "quiet" ? "quiet" : "other"] += rect(m);
    if (r.late) d.late += `M${m.x} ${g.lateY}h${m.w}v${g.lateH}h-${m.w}z`;
    if (r.evenSplit) d.split += dashedRect(m);
  }
  return d;
}

function Layer({
  rows,
  marks,
  g,
  compact,
  dim,
  lit,
}: {
  rows: TapeMark[];
  marks: Mark[];
  g: Geometry;
  compact: boolean;
  dim?: boolean;
  lit?: boolean;
}) {
  const d = useMemo(() => pathsOf(rows, marks, g), [rows, marks, g]);
  const origin = { transformOrigin: `0px ${g.mid}px` };
  return (
    <g className={dim ? "tape-dim" : undefined} data-lit={lit || undefined}>
      <g className="tape-rise" style={origin}>
        <path className="tape-stub" d={d.stub} />
        <path className="tape-other" d={d.other} />
        <path className="tape-loud" d={d.loud} />
      </g>
      <g className="tape-rise tape-rise-last" style={origin}>
        <path className={compact ? "tape-quiet tape-quiet-fill" : "tape-quiet"} d={d.quiet} />
        <path className="tape-split" d={d.split} />
      </g>
      <path className="tape-late" d={d.late} />
    </g>
  );
}

const Marks = memo(function Marks({
  tape,
  marks,
  g,
  width,
  compact,
  lit,
}: {
  tape: TapeData<TapeMark>;
  marks: Mark[];
  g: Geometry;
  width: number;
  compact: boolean;
  lit: TapeMark[] | null;
}) {
  const bands = useMemo(() => {
    const out: { x0: number; x1: number }[] = [];
    for (const r of lit ?? []) {
      const m = marks[r.index]!;
      const last = out.at(-1);
      if (last && m.x - last.x1 <= 16) last.x1 = m.x + m.w;
      else out.push({ x0: m.x, x1: m.x + m.w });
    }
    return out;
  }, [lit, marks]);
  return (
    <svg className="tape-svg" width={width} height={g.height} aria-hidden="true">
      {bands.map((b) => (
        <g key={b.x0}>
          <rect className="tape-band" x={b.x0 - 8} width={b.x1 - b.x0 + 16} height={g.height} />
          <path className="tape-band-edge" d={`M${b.x0 - 7} 0v${g.height}M${b.x1 + 7} 0v${g.height}`} />
        </g>
      ))}
      {!g.flat && (
        <path
          className="tape-ref"
          d={REFERENCES.map((r) => logHeight(r.musd, g))
            .map((h) => `M0 ${g.mid - h}.5H${width}M0 ${g.mid + h}.5H${width}`)
            .join("")}
        />
      )}
      <Layer rows={tape.rows} marks={marks} g={g} compact={compact} dim={!!lit} />
      {lit && <Layer rows={lit} marks={marks} g={g} compact={compact} lit />}
      <path className="tape-base" d={`M0 ${g.mid}.5H${width}`} />
      {!g.flat &&
        REFERENCES.map((ref, i) => (
          <text
            key={ref.label}
            className="tape-ref-label"
            x={i === 1 ? 2 : width - 2}
            y={g.mid - logHeight(ref.musd, g) + 3}
            textAnchor={i === 1 ? "start" : "end"}
          >
            {ref.label}
          </text>
        ))}
    </svg>
  );
});

const dollars = (r: TapeMark) =>
  r.musd == null
    ? "No CBO figure for this section"
    : r.musd === 0
      ? "$0"
      : `${musd(r.musd)} ${r.musd < 0 ? "cuts the deficit" : "adds to the deficit"}`;

const coverage = (r: TapeMark, tape: TapeData<TapeMark>) =>
  r.articles == null ? "coverage not measured" : `${r.articles} of ${tape.read.toLocaleString("en-US")} articles read`;

const describe = (r: TapeMark, tape: TapeData<TapeMark>) =>
  [
    r.label,
    KIND_NAME[r.kind],
    r.late && "added late",
    r.heading,
    dollars(r) + (r.evenSplit ? " (even split, an inference)" : ""),
    coverage(r, tape),
    count(r.lobbying, "lobbying report"),
  ]
    .filter(Boolean)
    .join(", ");

function Card({ row, tape, compact }: { row: TapeMark; tape: TapeData<TapeMark>; compact: boolean }) {
  const kind = [row.label, KIND_NAME[row.kind], row.late && "Added late"].filter(Boolean).join(" · ");
  if (compact)
    return (
      <>
        <p className="tape-card-kicker">
          {kind}
          {" · "}
          {row.musd == null ? "No CBO figure" : musd(row.musd)}
          {" · "}
          {row.articles ?? "?"} articles
        </p>
        <p className="tape-card-title">{row.heading}</p>
      </>
    );
  return (
    <>
      <p className="tape-card-kicker">{kind}</p>
      <p className="tape-card-title">{row.heading}</p>
      <p className="tape-card-money">
        {row.musd == null || row.musd === 0 ? (
          <span>{dollars(row)}</span>
        ) : (
          <>
            <b>{musd(row.musd)}</b>
            <span>{row.musd < 0 ? "cuts the deficit" : "adds to the deficit"}</span>
          </>
        )}
        {row.evenSplit && <em>Even split · inference</em>}
      </p>
      <p className="tape-card-facts">
        {coverage(row, tape)}
        {" · "}
        {count(row.lobbying, "lobbying report")}
      </p>
    </>
  );
}

function Legend({ tape }: { tape: TapeData<TapeMark> }) {
  return (
    <ul className="tape-legend">
      <li>
        <i className="sw sw-loud" />
        Headline
      </li>
      <li>
        <i className="sw sw-quiet" />
        Quiet and costly
      </li>
      <li>
        <i className="sw sw-other" />
        Other
      </li>
      {tape.rows.some((r) => r.late) && (
        <li>
          <i className="sw sw-late" />
          Added late
        </li>
      )}
      {tape.evenSplit > 0 && (
        <li>
          <i className="sw sw-split" />
          Dashed = even split (inference)
        </li>
      )}
      {tape.noFigure > 0 && !tape.flat && (
        <li>
          <i className="sw sw-stub" />
          No CBO figure ({tape.noFigure.toLocaleString("en-US")})
        </li>
      )}
      {tape.flat && <li className="tape-legend-note">No CBO figure per section: height shows kind, not cost</li>}
    </ul>
  );
}

const CHAR = 7.5;

function axisLabels(tape: TapeData<TapeMark>, width: number) {
  const bw = slot(width, tape.rows.length);
  const star = tape.groups.reduce<(typeof tape.groups)[number] | null>(
    (a, g) => (!a || g.quiet > a.quiet ? g : a),
    null,
  );
  const out: { key: string; left: number; text: string; bold: boolean }[] = [];
  tape.groups.forEach((g, i) => {
    const room = (g.to - g.from + 1) * bw;
    const long =
      g === star && g.quiet > 1
        ? `${g.label} · ${count(g.count, "section")} · ${g.quiet === tape.quiet ? "all" : `${g.quiet} of the`} ${tape.quiet} yellow marks`
        : null;
    const choices = [long, i === 0 ? g.label : null, g.short].filter((t): t is string => !!t);
    const text = choices.find((t) => t.length * CHAR <= room);
    if (text) out.push({ key: g.key, left: Math.round(g.from * bw), text, bold: text === long });
  });
  return out;
}

export function Tape<R extends TapeMark>({
  tape,
  onSelect,
  current,
  currentLabel = "You are here",
  highlight,
  pinned,
  caption,
  legend = true,
  axis,
  note,
}: TapeProps<R>) {
  const stage = useRef<HTMLDivElement>(null);
  const width = useWidth(stage);
  const compact = width > 0 && width < COMPACT_BELOW;
  const g = useMemo(() => geometry(compact, tape.flat), [compact, tape.flat]);
  const marks = useMemo(() => layout(tape, width, g), [tape, width, g]);
  const [active, setActive] = useState<number | null>(null);
  const pressed = useRef(false);
  const lastKey = useRef(0);
  const n = tape.rows.length;

  const lit = useMemo(() => (highlight ? tape.rows.filter((r) => highlight.has(r.id)) : null), [tape, highlight]);
  const currentIndex = useMemo(() => (current ? tape.rows.findIndex((r) => r.id === current) : -1), [tape, current]);
  const run = useMemo(() => (note ? quietRun(tape) : null), [tape, note]);
  const labels = useMemo(() => (width ? axisLabels(tape, width) : []), [tape, width]);
  if (!n) return null;

  const showAxis = axis ?? !compact;
  const move = (i: number | null) => {
    if (i != null) lastKey.current = i;
    setActive(i);
  };
  const at = (e: PointerEvent) => indexAt(e.clientX - stage.current!.getBoundingClientRect().left, width, n);

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    pressed.current = true;
    if (e.pointerType !== "mouse") stage.current!.setPointerCapture(e.pointerId);
    move(at(e));
  };
  const onPointerMove = (e: PointerEvent) => {
    const i = at(e);
    if (i === active) return;
    if (pressed.current && e.pointerType === "touch" && tape.rows[i]!.kind === "quiet") navigator.vibrate?.(10);
    move(i);
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!pressed.current) return;
    pressed.current = false;
    onSelect?.(tape.rows[at(e)]!);
    if (e.pointerType !== "mouse") setActive(null);
  };
  const onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType === "mouse") setActive(null);
  };
  const onPointerCancel = () => {
    pressed.current = false;
    setActive(null);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const cur = active ?? lastKey.current;
    const step = e.shiftKey ? 10 : 1;
    const quietFrom = (from: number, dir: 1 | -1) => {
      for (let i = from + dir; i >= 0 && i < n; i += dir) if (tape.rows[i]!.kind === "quiet") return i;
      return cur;
    };
    const next =
      e.key === "ArrowRight"
        ? Math.min(n - 1, cur + step)
        : e.key === "ArrowLeft"
          ? Math.max(0, cur - step)
          : e.key === "ArrowDown"
            ? quietFrom(cur, 1)
            : e.key === "ArrowUp"
              ? quietFrom(cur, -1)
              : e.key === "Home"
                ? 0
                : e.key === "End"
                  ? n - 1
                  : null;
    if (next != null) {
      e.preventDefault();
      move(next);
    } else if ((e.key === "Enter" || e.key === " ") && active != null) {
      e.preventDefault();
      onSelect?.(tape.rows[active]!);
    }
  };
  const onFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    if (active != null || !e.currentTarget.matches(":focus-visible")) return;
    move(
      currentIndex >= 0
        ? currentIndex
        : Math.max(
            0,
            tape.rows.findIndex((r) => r.kind === "quiet"),
          ),
    );
  };

  const shown = active == null ? null : tape.rows[active]!;
  const mark = shown && marks[shown.index]!;
  const centre = (m: Mark) => m.x + m.w / 2;
  const cur = currentIndex >= 0 ? marks[currentIndex]! : null;
  const runFrom = run && marks[run.from]!;
  const runTo = run && marks[run.to]!;

  return (
    <section className="tape" data-compact={compact || undefined} data-pinned={pinned || undefined}>
      {(caption || legend) && (
        <div className="tape-head">
          {caption && <p className="tape-caption">{caption}</p>}
          {legend && <Legend tape={tape} />}
        </div>
      )}
      <div
        ref={stage}
        className="tape-stage"
        style={{ height: g.height }}
        role="slider"
        aria-label={`The tape: ${count(n, "section")} in bill order. Up and down jump between quiet and costly marks, Enter opens one.`}
        aria-valuemin={1}
        aria-valuemax={n}
        aria-valuenow={(active ?? lastKey.current) + 1}
        aria-valuetext={describe(tape.rows[active ?? lastKey.current]!, tape)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onPointerCancel={onPointerCancel}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={() => setActive(null)}
      >
        {width > 0 && <Marks tape={tape} marks={marks} g={g} width={width} compact={compact} lit={lit} />}
        {!tape.lateKnown && (
          <p className="tape-late-note" style={{ top: g.lateY - 4 }} title={tape.lateReason ?? undefined}>
            Added-late flags unavailable for this bill
          </p>
        )}
        {cur && (
          <>
            <i className="tape-current" style={{ left: cur.x - 3, width: cur.w + 6 }} />
            <span
              className="tape-current-label"
              style={cur.x > width / 2 ? { right: width - cur.x - cur.w - 3 } : { left: cur.x - 3 }}
            >
              §{tape.rows[currentIndex]!.num} · {currentLabel}
            </span>
          </>
        )}
        {mark && (
          <i
            className="tape-hover"
            style={{ left: centre(mark) - Math.max(mark.w, 4) / 2, width: Math.max(mark.w, 4) }}
          />
        )}
        <div
          className="tape-card"
          aria-hidden="true"
          data-open={shown ? "" : undefined}
          style={
            mark
              ? { left: `clamp(var(--half), ${centre(mark)}px, calc(100% - var(--half)))`, top: g.height + 8 }
              : undefined
          }
        >
          {shown && <Card row={shown} tape={tape} compact={compact} />}
        </div>
      </div>
      {showAxis && tape.groups.length > 0 && (
        <div className="tape-axis">
          {labels.map((l) => (
            <span key={l.key} style={{ left: l.left }} data-bold={l.bold || undefined}>
              {l.text}
            </span>
          ))}
        </div>
      )}
      {run && runFrom && runTo && (
        <div className="tape-run" style={{ ["--stem" as string]: `${centre(runFrom) / 2 + centre(runTo) / 2}px` }}>
          <i className="tape-run-bracket" style={{ left: runFrom.x, width: runTo.x + runTo.w - runFrom.x }} />
          <p className="tape-run-text">
            <b>
              {tape.rows[run.from]!.label} to {tape.rows[run.to]!.label}
            </b>
            <span>{runNote(run, tape)}</span>
          </p>
        </div>
      )}
    </section>
  );
}
