import {
  memo,
  type PointerEvent as ReactPointer,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { count } from "../../lib/format.ts";
import { useMedia } from "../../lib/media.ts";
import type { Actor, BillModel } from "../../lib/model.ts";
import { coName, memberTag, money } from "./cards.ts";
import { Field, type Painter } from "./field.ts";
import {
  type Box,
  fit,
  inside,
  type Label,
  NAME_RADII,
  outside,
  RING_NAME_Y,
  RING_NAMES,
  ringNameBox,
  textWidth,
  VIEW,
} from "./labels.ts";
import { CH, CHANNELS, type MapView, type Scenes, type SectionMark, strokeWidths, TICK_LENGTH } from "./layout.ts";
import { C, fmt, pt, R, TAU, wrapTau } from "./polar.ts";
import { spokeOf, tieSet } from "./ties.ts";

export type Origin = { x: number; y: number };

export interface RingProps {
  m: BillModel;
  scenes: Scenes;
  view: MapView;
  pinned: string | null;
  onPin: (id: string | null, via: "pointer" | "key") => void;
  revealed: boolean;
  /** Whether the last change came from the keyboard, so ties switch with no drawing. */
  instant?: boolean;
  /** Static and decorative: the teaser's ring. */
  mini?: boolean;
  /** Square and touch-sized with no text: the phone sheet's ring. */
  compact?: boolean;
  labels?: boolean;
  /** Why this view has nothing to show; the ring then draws only the bill and its sections. */
  empty?: string | null;
  onKeyMove?: (id: string) => void;
  coarse?: boolean;
}

export interface RingHandle {
  originOf: (id: string) => Origin | null;
}

const MAX_MEMBER_LABELS = 8;
const f1 = (n: number) => Math.round(n * 10) / 10;

interface SectorGeom {
  d: string;
  start: number;
  end: number;
}

function sector(a0: number, a1: number, r0: number, r1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${fmt(pt(a0, r0))}L${fmt(pt(a0, r1))}A${r1} ${r1} 0 ${large} 1 ${fmt(pt(a1, r1))}L${fmt(pt(a1, r0))}A${r0} ${r0} 0 ${large} 0 ${fmt(pt(a0, r0))}Z`;
}

type MarkState = "idle" | "on" | "dim" | "peek";

interface MarkProps {
  i: number;
  kind: "company" | "member";
  state: MarkState;
  delay: number;
  live: boolean;
  optionId?: string;
  label?: string;
  selected?: boolean;
  reg: (i: number, el: SVGElement | null) => void;
}

const Mark = memo(function Mark({ i, kind, state, delay, live, optionId, label, selected, reg }: MarkProps) {
  const ref = useCallback((el: SVGElement | null) => reg(i, el), [reg, i]);
  const style = { "--sc-d": `${delay}ms` } as React.CSSProperties;
  if (kind === "company" && live)
    return (
      <rect
        ref={ref as React.Ref<SVGRectElement>}
        className={`sc-co sc-${state}`}
        style={style}
        id={optionId}
        role="option"
        aria-label={label}
        aria-selected={!!selected}
      />
    );
  if (kind === "company")
    return <rect ref={ref as React.Ref<SVGRectElement>} className={`sc-co sc-${state}`} style={style} />;
  return <circle ref={ref as React.Ref<SVGCircleElement>} className={`sc-mem sc-${state}`} style={style} />;
});

interface Bucket {
  key: string;
  level: SectionMark["level"];
  tone: SectionMark["tone"];
  estimate: boolean;
  idx: number[];
}

export const Ring = memo(function Ring({
  m,
  scenes,
  view,
  pinned,
  onPin,
  revealed,
  instant = false,
  mini = false,
  compact = false,
  labels = true,
  empty = null,
  onKeyMove,
  coarse = false,
  handle,
}: RingProps & { handle?: React.Ref<RingHandle> }) {
  const square = mini || compact;
  const uid = useId().replace(/:/g, "");
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const svgRef = useRef<SVGSVGElement>(null);
  const els = useRef<(SVGElement | null)[]>([]);
  const bucketEls = useRef<Map<string, SVGPathElement>>(new Map());
  const [hover, setHover] = useState<string | null>(null);
  const [roving, setRoving] = useState<string | null>(null);
  const [kfocus, setKfocus] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [scale, setScale] = useState(1);
  const [swept, setSwept] = useState(false);

  const nSections = scenes.sections.length;
  const buckets = useMemo(() => {
    const by = new Map<string, Bucket>();
    scenes.sections.forEach((s, k) => {
      const b = by.get(s.bucket) ?? { key: s.bucket, level: s.level, tone: s.tone, estimate: s.estimate, idx: [] };
      b.idx.push(scenes.index.get(s.id)!);
      by.set(s.bucket, b);
      void k;
    });
    return [...by.values()];
  }, [scenes]);
  const markIndex = useMemo(() => {
    const companies: number[] = [];
    const members: number[] = [];
    scenes.marks.forEach((x, i) => {
      if (x.kind === "company") companies.push(i);
      else if (x.kind === "member") members.push(i);
    });
    return { companies, members };
  }, [scenes]);

  const firstView = useRef(view);
  const field = useMemo(() => new Field(scenes, firstView.current), [scenes]);
  const widths = useMemo(() => strokeWidths(nSections, view), [nSections, view]);

  const reg = useCallback(
    (i: number, el: SVGElement | null) => {
      els.current[i] = el;
      if (el) paintOne(i, el, field.cur);
    },
    [field],
  );

  const painter = useMemo<Painter>(
    () => ({
      paint(cur) {
        for (const b of buckets) {
          const el = bucketEls.current.get(b.key);
          if (!el) continue;
          let d = "";
          for (const i of b.idx) {
            const o = i * CHANNELS;
            const a = cur[o + CH.angle]!;
            const cos = Math.cos(a);
            const sin = Math.sin(a);
            d += `M${f1(C + cur[o + CH.r0]! * cos)} ${f1(C + cur[o + CH.r0]! * sin)}L${f1(C + cur[o + CH.r1]! * cos)} ${f1(C + cur[o + CH.r1]! * sin)}`;
          }
          el.setAttribute("d", d);
        }
        const list = els.current;
        for (const i of markIndex.companies) if (list[i]) paintOne(i, list[i]!, cur);
        for (const i of markIndex.members) if (list[i]) paintOne(i, list[i]!, cur);
      },
    }),
    [buckets, markIndex],
  );

  useLayoutEffect(() => {
    field.attach(painter);
    return () => field.stop();
  }, [field, painter]);

  const first = useRef(true);
  useEffect(() => {
    field.setReduced(reduced);
    if (first.current) {
      first.current = false;
      field.go(view, false);
      return;
    }
    field.go(view, true);
  }, [field, view, reduced]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setScale(e.contentRect.width / (square ? 720 : VIEW.w)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [square]);

  const ringScene = view === "sections" ? null : scenes.ring[view];
  const layout = ringScene?.layout ?? null;
  const data = ringScene?.data ?? null;
  const groups = scenes.bars.groups;

  const items = useMemo(
    () =>
      view === "sections"
        ? groups.map((g) => ({
            id: g.group.id,
            label: `${g.group.label}, ${count(g.group.sections.length, "section")}`,
          }))
        : (layout?.companies ?? []).map((s) => {
            const a = m.actorById.get(s.id)!;
            const n = data?.byCompany.get(s.id)?.length ?? 0;
            return {
              id: s.id,
              label:
                view === "trades"
                  ? `${coName(a)}, ${count(n, "member")} traded its stock`
                  : `${coName(a)}, PAC money to ${count(n, "member")}`,
            };
          }),
    [view, groups, layout, data, m],
  );

  const activeId = pinned ?? hover ?? (kfocus ? roving : null);
  const activeKind: "company" | "member" | "group" | null = !activeId
    ? null
    : activeId.startsWith("group:")
      ? "group"
      : activeId.startsWith("member:")
        ? "member"
        : "company";
  const known =
    activeId == null
      ? false
      : activeKind === "group"
        ? view === "sections" && groups.some((g) => g.group.id === activeId)
        : activeKind === "member"
          ? !!layout?.member.has(activeId)
          : !!layout?.company.has(activeId);
  const focusId = known ? activeId : null;

  const tiesOn = useMemo(() => {
    if (!focusId || !layout || !data || activeKind === "group") return null;
    if (activeKind === "company") {
      const set = tieSet(data, layout, focusId);
      const a = m.actorById.get(focusId)!;
      const lobbied = m.edges.filter((e) => e.kind === "lobbied" && e.src === focusId);
      const inference = lobbied.length > 0 && lobbied.every((e) => e.inference);
      set.spoke = lobbied.length ? spokeOf(layout, focusId, inference, set.ties.length) : null;
      void a;
      return set;
    }
    const cos = (data.byMember.get(focusId) ?? []).map((t) => t.company);
    const ties = cos.flatMap((c) => tieSet(data, layout, c).ties.filter((t) => t.member === focusId));
    return { company: focusId, ties: ties.map((t, i) => ({ ...t, order: i })), spoke: null };
  }, [focusId, layout, data, activeKind, m]);

  const onSet = useMemo(() => {
    const s = new Set<string>();
    if (!focusId) return s;
    s.add(focusId);
    if (activeKind === "company") for (const t of data?.byCompany.get(focusId) ?? []) s.add(t.member);
    if (activeKind === "member") for (const t of data?.byMember.get(focusId) ?? []) s.add(t.company);
    return s;
  }, [focusId, activeKind, data]);

  const stateOf = (id: string): MarkState => {
    if (!focusId || activeKind === "group") return hover === id && !pinned ? "idle" : "idle";
    if (onSet.has(id)) return "on";
    if (pinned && hover === id) return "peek";
    return "dim";
  };

  const fs = Math.min(15, 12 / Math.max(scale, 0.01));
  const showLabels = labels && !square && scale > 0.55;

  const labelSet = useMemo(() => {
    if (!showLabels) return { names: [] as Box[], items: [] as Label[], flagged: null as Flag | null };
    const names: Box[] = [];
    if (view !== "sections") {
      const set = RING_NAMES[view];
      for (const [i, t] of set.entries()) names.push(ringNameBox(t, NAME_RADII[i]!, 11.5));
    } else {
      for (const d of scenes.bars.scale?.decades ?? []) {
        const r = scenes.bars.scale!.radius(d.t);
        names.push(ringNameBox(d.label, r, 11));
      }
    }
    const out: Label[] = [];
    const avoid = [...names];
    if (view === "sections") {
      const order = [...groups].sort((a, b) => b.group.sections.length - a.group.sections.length);
      const must = focusId ? order.filter((g) => g.group.id === focusId) : [];
      const rest = order.filter((g) => !must.includes(g));
      const cands = [...must, ...rest].map((g) => outside(g.group.id, g.group.label, g.mid, R.groupLabel, fs));
      out.push(...fit(cands, avoid, 99, 3));
      return { names, items: out, flagged: flaggedLabel(scenes, fs, [...avoid, ...out.map((l) => l.box)]) };
    }
    if (!layout || !data || !focusId) return { names, items: out, flagged: null };
    if (activeKind === "company") {
      const slot = layout.company.get(focusId)!;
      const a = m.actorById.get(focusId)!;
      const self = inside(focusId, coName(a), slot.angle, R.companyLabel, fs * 1.08);
      const kept = fit([self], avoid, 1, 2);
      avoid.push(...kept.map((k) => k.box));
      out.push(...kept);
      const ties = [...(data.byCompany.get(focusId) ?? [])].sort((x, y) => y.weight - x.weight);
      const cands = ties.flatMap((t) => {
        const s = layout.member.get(t.member);
        const v = m.memberById.get(t.member);
        return s && v ? [outside(t.member, memberTag(v), s.angle, R.memberLabel, fs)] : [];
      });
      out.push(...fit(cands, avoid, MAX_MEMBER_LABELS, 3));
    } else if (activeKind === "member") {
      const s = layout.member.get(focusId)!;
      const v = m.memberById.get(focusId)!;
      const self = outside(focusId, memberTag(v), s.angle, R.memberLabel, fs);
      const kept = fit([self], avoid, 1, 2);
      avoid.push(...kept.map((k) => k.box));
      out.push(...kept);
      const cands = (data.byMember.get(focusId) ?? []).flatMap((t) => {
        const c = layout.company.get(t.company);
        const a = m.actorById.get(t.company);
        return c && a ? [inside(t.company, coName(a), c.angle, R.companyLabel, fs)] : [];
      });
      out.push(...fit(cands, avoid, 6, 3));
    }
    return { names, items: out, flagged: null };
  }, [showLabels, view, groups, focusId, activeKind, layout, data, fs, m, scenes]);

  const hit = useCallback(
    (e: { clientX: number; clientY: number }): string | null => {
      const svg = svgRef.current;
      const ctm = svg?.getScreenCTM();
      if (!svg || !ctm) return null;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      const dx = p.x - C;
      const dy = p.y - C;
      const r = Math.hypot(dx, dy);
      const a = wrapTau(Math.atan2(dy, dx));
      const slop = (coarse ? 16 : 7) / Math.max(scale, 0.2);
      if (view === "sections") {
        if (r < R.groupArc - 8 || r > 350) return null;
        for (const g of groups) {
          const lo = wrapTau(g.start - 0.004);
          const hi = lo + (g.end - g.start) + 0.008;
          const at = wrapTau(a - lo);
          if (at <= hi - lo) return g.group.id;
        }
        return null;
      }
      if (!layout) return null;
      let best: string | null = null;
      let bestD = Number.POSITIVE_INFINITY;
      if (Math.abs(r - R.company) < 24 + slop) {
        for (const s of layout.companies) {
          const [x, y] = pt(s.angle, R.company);
          const d = Math.hypot(p.x - x, p.y - y);
          const reach = Math.min(s.size / 2 + slop, (R.company * (TAU - layout.gap)) / layout.companies.length / 2);
          if (d < reach && d < bestD) {
            best = s.id;
            bestD = d;
          }
        }
      }
      const rm = view === "trades" ? R.member : R.memberDots;
      if (best == null && Math.abs(r - rm) < 16 + slop) {
        for (const s of layout.members) {
          const [x, y] = pt(s.angle, rm);
          const d = Math.hypot(p.x - x, p.y - y);
          const reach = Math.max(s.size + slop * 0.6, 2.5);
          if (d < reach && d < bestD) {
            best = s.id;
            bestD = d;
          }
        }
      }
      return best;
    },
    [view, groups, layout, scale, coarse],
  );

  const onMove = (e: ReactPointer<SVGSVGElement>) => {
    if (mini || e.pointerType !== "mouse") return;
    const id = hit(e);
    setKeyboard(false);
    setHover((h) => (h === id ? h : id));
  };

  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (mini) return;
    e.stopPropagation();
    const id = hit(e);
    setKeyboard(false);
    if (id == null) {
      if (pinned) onPin(null, "pointer");
      return;
    }
    onPin(pinned === id ? null : id, "pointer");
  };

  const move = (dir: 1 | -1 | "home" | "end") => {
    if (!items.length) return;
    const from = items.findIndex((x) => x.id === (pinned ?? roving));
    const i =
      dir === "home"
        ? 0
        : dir === "end"
          ? items.length - 1
          : from < 0
            ? dir === 1
              ? 0
              : items.length - 1
            : (from + dir + items.length) % items.length;
    const id = items[i]!.id;
    setRoving(id);
    setHover(null);
    setKeyboard(true);
    onKeyMove?.(id);
    if (pinned) onPin(id, "key");
  };

  const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (mini) return;
    const k = e.key;
    if (k === "ArrowRight" || k === "ArrowDown") move(1);
    else if (k === "ArrowLeft" || k === "ArrowUp") move(-1);
    else if (k === "Home") move("home");
    else if (k === "End") move("end");
    else if (k === "Enter" || k === " ") {
      const id = roving ?? items[0]?.id;
      if (!id) return;
      setRoving(id);
      setKeyboard(true);
      onPin(pinned === id ? null : id, "key");
    } else if (k === "Escape") {
      if (pinned) onPin(null, "key");
      else return;
    } else return;
    e.preventDefault();
  };

  const originOf = useCallback(
    (id: string): Origin | null => {
      const i = scenes.index.get(id);
      const el = i == null ? null : els.current[i];
      if (el) {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
      const svg = svgRef.current;
      const g = groups.find((x) => x.group.id === id);
      const ctm = svg?.getScreenCTM();
      if (!g || !ctm) return null;
      const [x, y] = pt(g.mid, R.groupLabel - 20);
      const q = new DOMPoint(x, y).matrixTransform(ctm);
      return { x: q.x, y: q.y };
    },
    [scenes, groups],
  );
  useEffect(() => {
    if (typeof handle === "function") handle({ originOf });
    else if (handle) (handle as React.RefObject<RingHandle | null>).current = { originOf };
  }, [handle, originOf]);

  const rovingKnown = roving && items.some((x) => x.id === roving) ? roving : null;
  useEffect(() => {
    if (roving && !rovingKnown) setRoving(null);
  }, [roving, rovingKnown]);
  const activeDescendant = kfocus
    ? items.findIndex((x) => x.id === (rovingKnown ?? pinned ?? items[0]?.id)) >= 0
      ? `${uid}-o${items.findIndex((x) => x.id === (rovingKnown ?? pinned ?? items[0]?.id))}`
      : undefined
    : undefined;

  const mask = `${uid}-tie`;
  const sweep = `${uid}-sweep`;
  const sweeping = !revealed ? "pre" : !swept && !reduced ? "go" : "done";
  const solid = tiesOn?.ties.filter((t) => !t.inference) ?? [];
  const dashed = tiesOn?.ties.filter((t) => t.inference) ?? [];
  const spoke = tiesOn?.spoke ?? null;
  const needMask = dashed.length > 0 || !!spoke?.inference;

  const sectorGeoms = useMemo<Map<string, SectorGeom>>(
    () =>
      new Map(
        groups.map((g) => [
          g.group.id,
          { start: g.start, end: g.end, d: sector(g.start - 0.004, g.end + 0.004, R.groupArc - 6, 346) },
        ]),
      ),
    [groups],
  );

  const flagged = labelSet.flagged;
  const dimTicks = focusId && view !== "sections" ? "dim" : "";
  const barsDim = view === "sections" && focusId ? "dim" : "";
  const coCount = layout?.companies.length ?? 0;
  const memCount = layout?.members.length ?? 0;
  const delays = useMemo(() => {
    const d = new Map<string, number>();
    const nc = Math.max(coCount, 1);
    const nm = Math.max(memCount, 1);
    for (const [i, s] of (layout?.companies ?? []).entries()) d.set(s.id, 120 + (i / nc) * 100);
    for (const [i, s] of (layout?.members ?? []).entries()) d.set(s.id, 200 + (i / nm) * 100);
    return d;
  }, [layout, coCount, memCount]);

  const a11y = mini
    ? { role: "img", "aria-hidden": true }
    : {
        role: "listbox",
        "aria-label":
          view === "sections"
            ? "Titles of the bill. Arrow keys move, Enter pins."
            : "Companies tied to the bill. Arrow keys move, Enter pins.",
        "aria-activedescendant": activeDescendant,
      };
  const viewBox = square ? "0 0 720 720" : `${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`;
  const idx = (id: string) => items.findIndex((x) => x.id === id);

  return (
    <svg
      ref={svgRef}
      className={`sc-ring sc-${sweeping}`}
      data-view={view}
      data-hot={focusId ? "" : undefined}
      data-mini={mini ? "" : undefined}
      data-compact={compact ? "" : undefined}
      data-empty={empty ? "" : undefined}
      data-over={hover ? "" : undefined}
      viewBox={viewBox}
      {...a11y}
      tabIndex={mini ? undefined : 0}
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onFocus={(e) => setKfocus(e.currentTarget.matches(":focus-visible"))}
      onBlur={() => setKfocus(false)}
    >
      <title>{mini ? "Ring map of who is tied to this bill" : a11y["aria-label"]}</title>
      <defs>
        <mask id={sweep} maskUnits="userSpaceOnUse" x={-60} y={-20} width={840} height={760}>
          <circle
            className="sc-sweep"
            cx={C}
            cy={C}
            r={180}
            pathLength={1}
            transform={`rotate(-90 ${C} ${C})`}
            onAnimationEnd={() => setSwept(true)}
          />
        </mask>
        {needMask && (
          <mask id={mask} maskUnits="userSpaceOnUse" x={-60} y={-20} width={840} height={760}>
            <g className={`sc-ties-mask${instant || keyboard ? " sc-instant" : ""}`}>
              {dashed.map((t) => (
                <path
                  key={t.member}
                  d={t.d}
                  pathLength={1}
                  className="sc-tie"
                  style={{ "--sc-i": t.order, strokeWidth: t.width + 1 } as React.CSSProperties}
                />
              ))}
              {spoke?.inference && (
                <path
                  d={spoke.d}
                  pathLength={1}
                  className="sc-tie"
                  style={{ "--sc-i": spoke.order, strokeWidth: 2 } as React.CSSProperties}
                />
              )}
            </g>
          </mask>
        )}
      </defs>

      <g className="sc-guides">
        {R.guides.map((r) => (
          <circle key={r} cx={C} cy={C} r={r} />
        ))}
      </g>

      {view === "sections" && scenes.bars.scale && (
        <g className="sc-decades">
          {scenes.bars.scale.decades.map((d) => (
            <circle key={d.exp} cx={C} cy={C} r={scenes.bars.scale!.radius(d.t)} />
          ))}
        </g>
      )}

      <g mask={sweeping === "done" ? undefined : `url(#${sweep})`}>
        <g className={`sc-ticks sc-${dimTicks}`}>
          <g className={`sc-bars sc-${barsDim}`}>
            {buckets.map((b) => (
              <path
                key={b.key}
                ref={(el) => {
                  if (el) bucketEls.current.set(b.key, el);
                  else bucketEls.current.delete(b.key);
                }}
                className={`sc-tk sc-${b.level} sc-${b.tone}${b.estimate ? " sc-est" : ""}`}
                style={{ strokeWidth: f1(widths[b.level]) }}
              />
            ))}
          </g>
          {view === "sections" && focusId && activeKind === "group" && (
            <GroupBars scenes={scenes} groupId={focusId} widths={widths} />
          )}
        </g>
      </g>

      {view === "sections" && (
        <g className="sc-groups">
          {groups.map((g) => {
            const a0 = g.start;
            const a1 = g.end;
            const large = a1 - a0 > Math.PI ? 1 : 0;
            const o = idx(g.group.id);
            return (
              <g key={g.group.id}>
                <path
                  className={`sc-garc${focusId === g.group.id ? " sc-on" : ""}`}
                  d={`M${fmt(pt(a0, R.groupArc))}A${R.groupArc} ${R.groupArc} 0 ${large} 1 ${fmt(pt(a1, R.groupArc))}`}
                />
                <path
                  className={`sc-gsec${focusId === g.group.id ? " sc-on" : ""}${kfocus && rovingKnown === g.group.id ? " sc-kf" : ""}`}
                  d={sectorGeoms.get(g.group.id)!.d}
                  id={`${uid}-o${o}`}
                  role="option"
                  aria-label={items[o]?.label}
                  aria-selected={pinned === g.group.id}
                />
              </g>
            );
          })}
        </g>
      )}

      <g className={`sc-ties${instant || keyboard ? " sc-instant" : ""}`} key={`${focusId}-${view}`}>
        {needMask && (
          <g mask={`url(#${mask})`} className="sc-ties-dashed">
            {dashed.map((t) => (
              <path key={t.member} d={t.d} style={{ strokeWidth: t.width }} />
            ))}
            {spoke?.inference && <path d={spoke.d} className="sc-spoke" />}
          </g>
        )}
        <g className="sc-ties-solid">
          {solid.map((t) => (
            <path
              key={t.member}
              d={t.d}
              pathLength={1}
              className="sc-tie"
              style={{ "--sc-i": t.order, strokeWidth: t.width } as React.CSSProperties}
            />
          ))}
          {spoke && !spoke.inference && (
            <path
              d={spoke.d}
              pathLength={1}
              className="sc-tie sc-spoke"
              style={{ "--sc-i": spoke.order } as React.CSSProperties}
            />
          )}
        </g>
      </g>

      <g className="sc-companies">
        {markIndex.companies.map((i) => {
          const mk = scenes.marks[i]!;
          const live = !!layout?.company.has(mk.id);
          const o = live ? idx(mk.id) : -1;
          return (
            <Mark
              key={mk.id}
              i={i}
              kind="company"
              state={stateOf(mk.id)}
              delay={delays.get(mk.id) ?? 0}
              live={live}
              optionId={live && o >= 0 ? `${uid}-o${o}` : undefined}
              label={live && o >= 0 ? items[o]!.label : undefined}
              selected={pinned === mk.id}
              reg={reg}
            />
          );
        })}
      </g>
      <g className="sc-members">
        {markIndex.members.map((i) => {
          const mk = scenes.marks[i]!;
          return (
            <Mark
              key={mk.id}
              i={i}
              kind="member"
              state={stateOf(mk.id)}
              delay={delays.get(mk.id) ?? 0}
              live={false}
              reg={reg}
            />
          );
        })}
      </g>

      <circle className="sc-core" cx={C} cy={C} r={R.core} />
      {!square && (
        <g className="sc-core-text">
          <text x={C} y={C - 2} className="sc-t-core">
            {m.b.bill.display}
          </text>
          <text x={C} y={C + 17} className="sc-t-core-sub">
            {count(nSections, "section")}
          </text>
        </g>
      )}

      {showLabels && (
        <g className="sc-names" style={{ fontSize: `${11.5 / Math.max(scale, 0.01)}px` }}>
          {view !== "sections" &&
            RING_NAMES[view].map((t, i) => (
              <text key={t} x={C} y={RING_NAME_Y(NAME_RADII[i]!)} className="sc-t-name">
                {t}
              </text>
            ))}
          {view === "sections" &&
            scenes.bars.scale?.decades.map((d) => (
              <text key={d.exp} x={C} y={RING_NAME_Y(scenes.bars.scale!.radius(d.t))} className="sc-t-name sc-t-decade">
                {d.label}
              </text>
            ))}
        </g>
      )}

      {showLabels && view === "sections" && (
        <g className="sc-group-labels" style={{ fontSize: `${fs}px` }}>
          {labelSet.items.map((l) => (
            <text
              key={l.id}
              x={f1(l.x)}
              y={f1(l.y)}
              textAnchor={l.anchor}
              className={`sc-t-label${l.id === focusId ? " sc-on" : ""}`}
            >
              {l.text}
            </text>
          ))}
          {flagged && (
            <g className="sc-flagged">
              <circle className="sc-flag-ring" cx={f1(flagged.tip[0])} cy={f1(flagged.tip[1])} r={7} />
              <text
                x={f1(flagged.label.x)}
                y={f1(flagged.label.y)}
                textAnchor={flagged.label.anchor}
                className="sc-t-flag"
              >
                {flagged.label.text}
              </text>
              <text
                x={f1(flagged.label.x)}
                y={f1(flagged.label.y + flagged.lead)}
                textAnchor={flagged.label.anchor}
                className="sc-t-flag-sub"
              >
                {flagged.sub}
              </text>
            </g>
          )}
        </g>
      )}

      {showLabels && view !== "sections" && (
        <g className="sc-focus-labels" style={{ fontSize: `${fs}px` }} key={`labels-${focusId}-${view}`}>
          {labelSet.items.map((l) => (
            <text
              key={l.id}
              x={f1(l.x)}
              y={f1(l.y)}
              textAnchor={l.anchor}
              className={l.id === focusId ? "sc-t-label sc-co-label" : "sc-t-label"}
            >
              {l.text}
            </text>
          ))}
        </g>
      )}

      {kfocus && rovingKnown && view !== "sections" && layout?.company.get(rovingKnown) && (
        <KeyRing angle={layout.company.get(rovingKnown)!.angle} size={layout.company.get(rovingKnown)!.size} />
      )}

      {empty && !square && (
        <g className="sc-empty">
          <text x={C} y={C + 178} className="sc-t-empty" style={{ fontSize: `${14 / Math.max(scale, 0.01)}px` }}>
            {wrapWords(empty, 34).map((line, k) => (
              <tspan key={line} x={C} dy={k ? "1.35em" : 0}>
                {line}
              </tspan>
            ))}
          </text>
        </g>
      )}
    </svg>
  );
});

function wrapWords(s: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of s.split(" ")) {
    if (line && line.length + w.length + 1 > max) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}

function KeyRing({ angle, size }: { angle: number; size: number }) {
  const [x, y] = pt(angle, R.company);
  const s = size + 9;
  return <rect className="sc-kring" x={f1(x - s / 2)} y={f1(y - s / 2)} width={s} height={s} rx={5} />;
}

function GroupBars({
  scenes,
  groupId,
  widths,
}: {
  scenes: Scenes;
  groupId: string;
  widths: Record<SectionMark["level"], number>;
}) {
  const paths = useMemo(() => {
    const by = new Map<string, { s: SectionMark; d: string }[]>();
    const t = scenes.targets.sections.t;
    for (const s of scenes.sections) {
      if (`group:${scenes.groups[s.group]!.key || "general"}` !== groupId) continue;
      const o = scenes.index.get(s.id)! * CHANNELS;
      const a = t[o + CH.angle]!;
      const d = `M${fmt(pt(a, t[o + CH.r0]!))}L${fmt(pt(a, t[o + CH.r1]!))}`;
      const list = by.get(s.bucket) ?? [];
      list.push({ s, d });
      by.set(s.bucket, list);
    }
    return [...by.entries()].map(([key, list]) => ({ key, s: list[0]!.s, d: list.map((x) => x.d).join("") }));
  }, [scenes, groupId]);
  return (
    <g className="sc-bars-on">
      {paths.map((p) => (
        <path
          key={p.key}
          d={p.d}
          className={`sc-tk sc-${p.s.level} sc-${p.s.tone}${p.s.estimate ? " sc-est" : ""}`}
          style={{ strokeWidth: f1(widths[p.s.level] * 1.15) }}
        />
      ))}
    </g>
  );
}

interface Flag {
  label: Label;
  sub: string;
  tip: [number, number];
  lead: number;
}

const clip = (s: string, max: number) => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max >> 1)).replace(/[,;:]$/, "")}…`;
};

function flaggedLabel(scenes: Scenes, fs: number, avoid: Box[]): Flag | null {
  let best: SectionMark | null = null;
  for (const s of scenes.sections)
    if (
      s.level === "buried" &&
      s.v.dollarsMusd != null &&
      (!best || Math.abs(s.v.dollarsMusd) > Math.abs(best.v.dollarsMusd!))
    )
      best = s;
  if (!best) return null;
  const t = scenes.targets.sections.t;
  const o = scenes.index.get(best.id)! * CHANNELS;
  const a = t[o + CH.angle]!;
  const r = t[o + CH.r1]!;
  const hits = best.v.s.attention?.hits;
  const sub = hits == null ? "not scored for news" : `${count(hits, "article")}`;
  const sign = best.v.dollarsMusd! < 0 ? "−" : "+";
  const text = `${clip(best.v.s.heading, 30)}, ${sign}${money(Math.abs(best.v.dollarsMusd!) * 1e6)}`;
  const l = outside(best.id, text, a, r + 18, fs);
  const lead = fs * 1.3;
  l.box.y1 += lead;
  l.box.x1 = Math.max(l.box.x1, l.box.x0 + textWidth(sub, fs));
  const kept = fit([l], avoid, 1, 2)[0];
  return kept ? { label: kept, sub, tip: pt(a, r), lead } : null;
}

function paintOne(i: number, el: SVGElement, cur: Float64Array) {
  const o = i * CHANNELS;
  const a = cur[o + CH.angle]!;
  const r = cur[o + CH.r0]!;
  const size = cur[o + CH.size]!;
  const x = C + r * Math.cos(a);
  const y = C + r * Math.sin(a);
  if (el instanceof SVGRectElement) {
    const s = Math.max(size - 3, 1);
    el.setAttribute("x", f1(x - s / 2).toString());
    el.setAttribute("y", f1(y - s / 2).toString());
    el.setAttribute("width", f1(s).toString());
    el.setAttribute("height", f1(s).toString());
  } else {
    el.setAttribute("cx", f1(x).toString());
    el.setAttribute("cy", f1(y).toString());
    el.setAttribute("r", f1(size).toString());
  }
  el.style.setProperty("--sc-a", cur[o + CH.alpha]!.toFixed(3));
}

export { TICK_LENGTH };
