import { articlesOf } from "@antibody/core";
import { memo, useCallback, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointer } from "react";
import { count } from "../../lib/format.ts";
import { useMedia } from "../../lib/media.ts";
import type { BillModel } from "../../lib/model.ts";
import { coName, memberTag, money } from "./cards.ts";
import { Field } from "./field.ts";
import type { Painter } from "./field.ts";
import { fit, inside, NAME_RADII, outside, RING_NAME_Y, RING_NAMES, ringNameBox, textWidth, VIEW } from "./labels.ts";
import type { Box, Label } from "./labels.ts";
import { CH, CHANNELS, strokeWidths } from "./layout.ts";
import type { MapView, Scenes, SectionMark } from "./layout.ts";
import { C, fmt, pt, R, TAU, wrapTau } from "./polar.ts";
import { spokeOf, tieSet } from "./ties.ts";

export interface Origin {
  x: number;
  y: number;
}

export interface RingProps {
  m: BillModel;
  scenes: Scenes;
  view: MapView;
  pinned: string | null;
  onPin: (id: string | null, via: "pointer" | "key") => void;
  revealed: boolean;
  instant?: boolean;
  mini?: boolean;
  compact?: boolean;
  labels?: boolean;
  empty?: string | null;
  onKeyMove?: (id: string) => void;
  coarse?: boolean;
}

export interface RingHandle {
  originOf: (id: string) => Origin | null;
}

const MAX_MEMBER_LABELS = 8;
const f1 = (n: number) => Math.round(n * 10) / 10;

const channel = (t: Float64Array, i: number, c: number) => t[i * CHANNELS + c] ?? 0;

const cssVars = (style: CSSProperties & Record<`--${string}`, string | number>): CSSProperties => style;

const ringNameRows = (view: Exclude<MapView, "sections">) => {
  const [inner, middle, outer] = RING_NAMES[view];
  const [rInner, rMiddle, rOuter] = NAME_RADII;

  return [
    { text: inner, r: rInner },
    { text: middle, r: rMiddle },
    { text: outer, r: rOuter },
  ];
};

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`ring: ${what} missing from the scene`);
  }

  return value;
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
  optionId?: string | undefined;
  label?: string | undefined;
  selected?: boolean;
  reg: (i: number, el: SVGElement | null) => void;
}

function MarkShape({ i, kind, state, delay, live, optionId, label, selected, reg }: MarkProps) {
  const ref = useCallback(
    (el: SVGElement | null) => {
      reg(i, el);
    },
    [reg, i],
  );

  const style = cssVars({ "--sc-d": `${delay}ms` });

  if (kind === "company" && live) {
    return (
      <rect
        ref={ref}
        className={`sc-co sc-${state}`}
        style={style}
        id={optionId}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- SVG has no <option>; company marks are the ring's listbox options
        role="option"
        aria-label={label}
        aria-selected={selected === true}
      />
    );
  }

  if (kind === "company") {
    return <rect ref={ref} className={`sc-co sc-${state}`} style={style} />;
  }

  return <circle ref={ref} className={`sc-mem sc-${state}`} style={style} />;
}

const Mark = memo(MarkShape);

interface Bucket {
  key: string;
  level: SectionMark["level"];
  tone: SectionMark["tone"];
  estimate: boolean;
  idx: number[];
}

interface LabelSet {
  names: Box[];
  items: Label[];
  flagged: Flag | null;
}

function RingMap({
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
  const uid = useId().replaceAll(":", "");
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const svgEl = useRef<SVGSVGElement>(null);
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
      b.idx.push(k);
      by.set(s.bucket, b);
    });

    return [...by.values()];
  }, [scenes]);

  const markIndex = useMemo(() => {
    const companies: { i: number; id: string }[] = [];
    const members: { i: number; id: string }[] = [];
    scenes.marks.forEach((x, i) => {
      if (x.kind === "company") {
        companies.push({ i, id: x.id });
      } else if (x.kind === "member") {
        members.push({ i, id: x.id });
      }
    });

    return { companies, members };
  }, [scenes]);

  // oxlint-disable-next-line react/hook-use-state -- the view the ring first drew: a new scene set starts there and animates to the current view
  const [firstView] = useState(view);
  const field = useMemo(() => new Field(scenes, firstView), [scenes, firstView]);
  const widths = useMemo(() => strokeWidths(nSections, view), [nSections, view]);

  const reg = useCallback(
    (i: number, el: SVGElement | null) => {
      els.current[i] = el;

      if (el) {
        paintOne(i, el, field.cur);
      }
    },
    [field],
  );

  const painter = useMemo<Painter>(
    () => ({
      paint(cur) {
        for (const b of buckets) {
          const el = bucketEls.current.get(b.key);

          if (!el) {
            continue;
          }

          let d = "";

          for (const i of b.idx) {
            const a = channel(cur, i, CH.angle);
            const r0 = channel(cur, i, CH.r0);
            const r1 = channel(cur, i, CH.r1);
            const cos = Math.cos(a);
            const sin = Math.sin(a);
            d += `M${f1(C + r0 * cos)} ${f1(C + r0 * sin)}L${f1(C + r1 * cos)} ${f1(C + r1 * sin)}`;
          }

          el.setAttribute("d", d);
        }

        const list = els.current;

        for (const { i } of [...markIndex.companies, ...markIndex.members]) {
          const el = list[i];

          if (el) {
            paintOne(i, el, cur);
          }
        }
      },
    }),
    [buckets, markIndex, bucketEls, els],
  );

  const first = useRef(true);

  const svgRef = useCallback(
    (svg: SVGSVGElement | null) => {
      svgEl.current = svg;

      if (!svg) {
        return;
      }

      field.attach(painter);
      field.setReduced(reduced);
      field.go(view, !first.current);
      first.current = false;

      const ro = new ResizeObserver(([e]) => {
        if (e) {
          setScale(e.contentRect.width / (square ? 720 : VIEW.w));
        }
      });

      ro.observe(svg);

      return () => {
        ro.disconnect();
        field.stop();
      };
    },
    [field, painter, reduced, view, square],
  );

  const decadeScale = scenes.bars.scale;
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
            const a = need(m.actorById.get(s.id), s.id);
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

  const rovingKnown = roving !== null && items.some((x) => x.id === roving) ? roving : null;
  const activeId = pinned ?? hover ?? (kfocus ? rovingKnown : null);

  const activeKind: "company" | "member" | "group" | null =
    activeId === null || activeId === ""
      ? null
      : activeId.startsWith("group:")
        ? "group"
        : activeId.startsWith("member:")
          ? "member"
          : "company";

  const known =
    activeId === null
      ? false
      : activeKind === "group"
        ? view === "sections" && groups.some((g) => g.group.id === activeId)
        : activeKind === "member"
          ? layout?.member.has(activeId) === true
          : layout?.company.has(activeId) === true;

  const focusId = known ? activeId : null;

  const tiesOn = useMemo(() => {
    if (focusId === null || !layout || !data || activeKind === "group") {
      return null;
    }

    if (activeKind === "company") {
      const set = tieSet(data, layout, focusId);
      const lobbied = m.edges.filter((e) => e.kind === "lobbied" && e.src === focusId);
      const inference = lobbied.length > 0 && lobbied.every((e) => e.inference);
      set.spoke = lobbied.length > 0 ? spokeOf(layout, focusId, inference, set.ties.length) : null;

      return set;
    }

    const cos = (data.byMember.get(focusId) ?? []).map((t) => t.company);
    const ties = cos.flatMap((c) => tieSet(data, layout, c).ties.filter((t) => t.member === focusId));

    return { company: focusId, ties: ties.map((t, i) => ({ ...t, order: i })), spoke: null };
  }, [focusId, layout, data, activeKind, m]);

  const onSet = useMemo(() => {
    const s = new Set<string>();

    if (focusId === null) {
      return s;
    }

    s.add(focusId);

    if (activeKind === "company") {
      for (const t of data?.byCompany.get(focusId) ?? []) {
        s.add(t.member);
      }
    }

    if (activeKind === "member") {
      for (const t of data?.byMember.get(focusId) ?? []) {
        s.add(t.company);
      }
    }

    return s;
  }, [focusId, activeKind, data]);

  const stateOf = (id: string): MarkState => {
    if (focusId === null || activeKind === "group") {
      return "idle";
    }

    if (onSet.has(id)) {
      return "on";
    }

    if (pinned !== null && hover === id) {
      return "peek";
    }

    return "dim";
  };

  const fs = Math.min(15, 12 / Math.max(scale, 0.01));
  const showLabels = labels && !square && scale > 0.55;

  const labelSet = useMemo<LabelSet>(() => {
    if (!showLabels) {
      return { names: [], items: [], flagged: null };
    }

    const names: Box[] = [];
    const decades = scenes.bars.scale;

    if (view === "sections") {
      if (decades) {
        for (const d of decades.decades) {
          names.push(ringNameBox(d.label, decades.radius(d.t), 11));
        }
      }
    } else {
      for (const row of ringNameRows(view)) {
        names.push(ringNameBox(row.text, row.r, 11.5));
      }
    }

    const out: Label[] = [];
    const avoid = [...names];

    if (view === "sections") {
      const order = groups.toSorted((a, b) => b.group.sections.length - a.group.sections.length);
      const must = focusId === null ? [] : order.filter((g) => g.group.id === focusId);
      const rest = order.filter((g) => !must.includes(g));
      const cands = [...must, ...rest].map((g) => outside(g.group.id, g.group.label, g.mid, R.groupLabel, fs));
      out.push(...fit(cands, avoid, 99, 3));

      return { names, items: out, flagged: flaggedLabel(scenes, fs, [...avoid, ...out.map((l) => l.box)]) };
    }

    if (!layout || !data || focusId === null) {
      return { names, items: out, flagged: null };
    }

    if (activeKind === "company") {
      const slot = need(layout.company.get(focusId), focusId);
      const a = need(m.actorById.get(focusId), focusId);
      const self = inside(focusId, coName(a), slot.angle, R.companyLabel, fs * 1.08);
      const kept = fit([self], avoid, 1, 2);
      avoid.push(...kept.map((k) => k.box));
      out.push(...kept);
      const ties = (data.byCompany.get(focusId) ?? []).toSorted((x, y) => y.weight - x.weight);

      const cands = ties.flatMap((t) => {
        const s = layout.member.get(t.member);
        const v = m.memberById.get(t.member);

        return s && v ? [outside(t.member, memberTag(v), s.angle, R.memberLabel, fs)] : [];
      });

      out.push(...fit(cands, avoid, MAX_MEMBER_LABELS, 3));
    } else if (activeKind === "member") {
      const s = need(layout.member.get(focusId), focusId);
      const v = need(m.memberById.get(focusId), focusId);
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
      const svg = svgEl.current;
      const ctm = svg?.getScreenCTM();

      if (!svg || !ctm) {
        return null;
      }

      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      const dx = p.x - C;
      const dy = p.y - C;
      const r = Math.hypot(dx, dy);
      const a = wrapTau(Math.atan2(dy, dx));
      const slop = (coarse ? 16 : 7) / Math.max(scale, 0.2);

      if (view === "sections") {
        if (r < R.groupArc - 8 || r > 350) {
          return null;
        }

        for (const g of groups) {
          const lo = wrapTau(g.start - 0.004);
          const hi = lo + (g.end - g.start) + 0.008;
          const at = wrapTau(a - lo);

          if (at <= hi - lo) {
            return g.group.id;
          }
        }

        return null;
      }

      if (!layout) {
        return null;
      }

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

      if (best === null && Math.abs(r - rm) < 16 + slop) {
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
    if (mini || e.pointerType !== "mouse") {
      return;
    }

    const id = hit(e);
    setKeyboard(false);
    setHover((h) => (h === id ? h : id));
  };

  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (mini) {
      return;
    }

    e.stopPropagation();
    const id = hit(e);
    setKeyboard(false);

    if (id === null) {
      if (pinned !== null) {
        onPin(null, "pointer");
      }

      return;
    }

    onPin(pinned === id ? null : id, "pointer");
  };

  const move = (dir: 1 | -1 | "home" | "end") => {
    if (items.length === 0) {
      return;
    }

    const from = items.findIndex((x) => x.id === (pinned ?? rovingKnown));

    const i =
      dir === "home"
        ? 0
        : dir === "end"
          ? items.length - 1
          : from === -1
            ? dir === 1
              ? 0
              : items.length - 1
            : (from + dir + items.length) % items.length;

    const item = items[i];

    if (!item) {
      return;
    }

    const { id } = item;
    setRoving(id);
    setHover(null);
    setKeyboard(true);
    onKeyMove?.(id);

    if (pinned !== null) {
      onPin(id, "key");
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (mini) {
      return;
    }

    const k = e.key;

    if (k === "ArrowRight" || k === "ArrowDown") {
      move(1);
    } else if (k === "ArrowLeft" || k === "ArrowUp") {
      move(-1);
    } else if (k === "Home") {
      move("home");
    } else if (k === "End") {
      move("end");
    } else if (k === "Enter" || k === " ") {
      const id = rovingKnown ?? items[0]?.id;

      if (id === undefined) {
        return;
      }

      setRoving(id);
      setKeyboard(true);
      onPin(pinned === id ? null : id, "key");
    } else if (k === "Escape") {
      if (pinned === null) {
        return;
      }

      onPin(null, "key");
    } else {
      return;
    }

    e.preventDefault();
  };

  const originOf = useCallback(
    (id: string): Origin | null => {
      const i = scenes.index.get(id);
      const el = i === undefined ? null : els.current[i];

      if (el) {
        const r = el.getBoundingClientRect();

        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }

      const svg = svgEl.current;
      const g = groups.find((x) => x.group.id === id);
      const ctm = svg?.getScreenCTM();

      if (!g || !ctm) {
        return null;
      }

      const [x, y] = pt(g.mid, R.groupLabel - 20);
      const q = new DOMPoint(x, y).matrixTransform(ctm);

      return { x: q.x, y: q.y };
    },
    [scenes, groups],
  );

  useImperativeHandle(handle, () => ({ originOf }), [originOf]);

  const descendant = kfocus ? items.findIndex((x) => x.id === (rovingKnown ?? pinned ?? items[0]?.id)) : -1;
  const activeDescendant = descendant === -1 ? undefined : `${uid}-o${descendant}`;

  const mask = `${uid}-tie`;
  const sweep = `${uid}-sweep`;
  const sweeping = revealed ? (swept || reduced ? "done" : "go") : "pre";
  const solid = tiesOn?.ties.filter((t) => !t.inference) ?? [];
  const dashed = tiesOn?.ties.filter((t) => t.inference) ?? [];
  const spoke = tiesOn?.spoke ?? null;
  const needMask = dashed.length > 0 || spoke?.inference === true;

  const groupSectors = useMemo(
    () => groups.map((g) => ({ g, sector: sector(g.start - 0.004, g.end + 0.004, R.groupArc - 6, 346) })),
    [groups],
  );

  const flagged = labelSet.flagged;
  const dimTicks = focusId !== null && view !== "sections" ? "dim" : "";
  const barsDim = view === "sections" && focusId !== null ? "dim" : "";
  const coCount = layout?.companies.length ?? 0;
  const memCount = layout?.members.length ?? 0;

  const delays = useMemo(() => {
    const d = new Map<string, number>();
    const nc = Math.max(coCount, 1);
    const nm = Math.max(memCount, 1);

    for (const [i, s] of (layout?.companies ?? []).entries()) {
      d.set(s.id, 120 + (i / nc) * 100);
    }

    for (const [i, s] of (layout?.members ?? []).entries()) {
      d.set(s.id, 200 + (i / nm) * 100);
    }

    return d;
  }, [layout, coCount, memCount]);

  const listLabel =
    view === "sections"
      ? "Titles of the bill. Arrow keys move, Enter pins."
      : "Companies tied to the bill. Arrow keys move, Enter pins.";

  const keySlot = kfocus && rovingKnown !== null && view !== "sections" ? layout?.company.get(rovingKnown) : undefined;

  const viewBox = square ? "0 0 720 720" : `${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`;
  const idx = (id: string) => items.findIndex((x) => x.id === id);

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- role is listbox whenever the handlers act; the mini ring is an img and its handlers return early
    <svg
      ref={svgRef}
      className={`sc-ring sc-${sweeping}`}
      data-view={view}
      data-hot={focusId === null ? undefined : ""}
      data-mini={mini ? "" : undefined}
      data-compact={compact ? "" : undefined}
      data-empty={empty === null || empty === "" ? undefined : ""}
      data-over={hover === null ? undefined : ""}
      viewBox={viewBox}
      role={mini ? "img" : "listbox"}
      aria-hidden={mini ? true : undefined}
      aria-label={mini ? undefined : listLabel}
      aria-activedescendant={mini ? undefined : activeDescendant}
      tabIndex={mini ? undefined : 0}
      onPointerMove={onMove}
      onPointerLeave={() => {
        setHover(null);
      }}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        setKfocus(e.currentTarget.matches(":focus-visible"));
      }}
      onBlur={() => {
        setKfocus(false);
      }}
    >
      <title>{mini ? "Ring map of who is tied to this bill" : listLabel}</title>
      <defs>
        <mask id={sweep} maskUnits="userSpaceOnUse" x={-60} y={-20} width={840} height={760}>
          <circle
            className="sc-sweep"
            cx={C}
            cy={C}
            r={180}
            pathLength={1}
            transform={`rotate(-90 ${C} ${C})`}
            onAnimationEnd={() => {
              setSwept(true);
            }}
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
                  style={cssVars({ "--sc-i": t.order, strokeWidth: t.width + 1 })}
                />
              ))}
              {spoke?.inference === true && (
                <path
                  d={spoke.d}
                  pathLength={1}
                  className="sc-tie"
                  style={cssVars({ "--sc-i": spoke.order, strokeWidth: 2 })}
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

      {view === "sections" && decadeScale && (
        <g className="sc-decades">
          {decadeScale.decades.map((d) => (
            <circle key={d.exp} cx={C} cy={C} r={decadeScale.radius(d.t)} />
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
                  if (el) {
                    bucketEls.current.set(b.key, el);
                  } else {
                    bucketEls.current.delete(b.key);
                  }
                }}
                className={`sc-tk sc-${b.level} sc-${b.tone}${b.estimate ? " sc-est" : ""}`}
                style={{ strokeWidth: f1(widths[b.level]) }}
              />
            ))}
          </g>
          {view === "sections" && focusId !== null && activeKind === "group" && (
            <GroupBars scenes={scenes} groupId={focusId} widths={widths} />
          )}
        </g>
      </g>

      {view === "sections" && (
        <g className="sc-groups">
          {groupSectors.map(({ g, sector: d }) => {
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
                  d={d}
                  id={`${uid}-o${o}`}
                  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- SVG has no <option>; the ring's sectors are listbox options
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
            {spoke?.inference === true && <path d={spoke.d} className="sc-spoke" />}
          </g>
        )}
        <g className="sc-ties-solid">
          {solid.map((t) => (
            <path
              key={t.member}
              d={t.d}
              pathLength={1}
              className="sc-tie"
              style={cssVars({ "--sc-i": t.order, strokeWidth: t.width })}
            />
          ))}
          {spoke && !spoke.inference && (
            <path d={spoke.d} pathLength={1} className="sc-tie sc-spoke" style={cssVars({ "--sc-i": spoke.order })} />
          )}
        </g>
      </g>

      <g className="sc-companies">
        {markIndex.companies.map(({ i, id }) => {
          const live = layout?.company.has(id) === true;
          const o = live ? idx(id) : -1;

          return (
            <Mark
              key={id}
              i={i}
              kind="company"
              state={stateOf(id)}
              delay={delays.get(id) ?? 0}
              live={live}
              optionId={o === -1 ? undefined : `${uid}-o${o}`}
              label={items[o]?.label}
              selected={pinned === id}
              reg={reg}
            />
          );
        })}
      </g>
      <g className="sc-members">
        {markIndex.members.map(({ i, id }) => (
          <Mark key={id} i={i} kind="member" state={stateOf(id)} delay={delays.get(id) ?? 0} live={false} reg={reg} />
        ))}
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
            ringNameRows(view).map((row) => (
              <text key={row.text} x={C} y={RING_NAME_Y(row.r)} className="sc-t-name">
                {row.text}
              </text>
            ))}
          {view === "sections" &&
            decadeScale?.decades.map((d) => (
              <text key={d.exp} x={C} y={RING_NAME_Y(decadeScale.radius(d.t))} className="sc-t-name sc-t-decade">
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

      {keySlot && <KeyRing angle={keySlot.angle} size={keySlot.size} />}

      {empty !== null && empty !== "" && !square && (
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
}

export const Ring = memo(RingMap);

function wrapWords(s: string, max: number): string[] {
  const out: string[] = [];
  let line = "";

  for (const w of s.split(" ")) {
    if (line && line.length + w.length + 1 > max) {
      out.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }

  if (line) {
    out.push(line);
  }

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
    const by = new Map<string, { s: SectionMark; d: string }>();
    const t = scenes.targets.sections.t;

    for (const [k, s] of scenes.sections.entries()) {
      if (scenes.groups[s.group]?.id !== groupId) {
        continue;
      }

      const a = channel(t, k, CH.angle);
      const d = `M${fmt(pt(a, channel(t, k, CH.r0)))}L${fmt(pt(a, channel(t, k, CH.r1)))}`;
      const bucket = by.get(s.bucket);

      if (bucket) {
        bucket.d += d;
      } else {
        by.set(s.bucket, { s, d });
      }
    }

    return [...by.entries()].map(([key, { s, d }]) => ({ key, s, d }));
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
  if (s.length <= max) {
    return s;
  }

  const cut = s.slice(0, max - 1);

  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), Math.floor(max / 2))).replace(/[,;:]$/u, "")}…`;
};

function flaggedLabel(scenes: Scenes, fs: number, avoid: Box[]): Flag | null {
  let best: { s: SectionMark; k: number; musd: number } | null = null;

  for (const [k, s] of scenes.sections.entries()) {
    const musd = s.v.dollarsMusd;

    if (s.level === "buried" && musd !== null && (best === null || Math.abs(musd) > Math.abs(best.musd))) {
      best = { s, k, musd };
    }
  }

  if (best === null) {
    return null;
  }

  const { s, k, musd } = best;
  const t = scenes.targets.sections.t;
  const a = channel(t, k, CH.angle);
  const r = channel(t, k, CH.r1);
  const hits = articlesOf(s.v.s);
  const sub = hits === null ? "not scored for news" : count(hits, "article");
  const sign = musd < 0 ? "−" : "+";
  const text = `${clip(s.v.s.heading, 30)}, ${sign}${money(Math.abs(musd) * 1e6)}`;
  const l = outside(s.id, text, a, r + 18, fs);
  const lead = fs * 1.3;
  l.box.y1 += lead;
  l.box.x1 = Math.max(l.box.x1, l.box.x0 + textWidth(sub, fs));
  const kept = fit([l], avoid, 1, 2)[0];

  return kept ? { label: kept, sub, tip: pt(a, r), lead } : null;
}

function paintOne(i: number, el: SVGElement, cur: Float64Array) {
  const a = channel(cur, i, CH.angle);
  const r = channel(cur, i, CH.r0);
  const size = channel(cur, i, CH.size);
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

  el.style.setProperty("--sc-a", channel(cur, i, CH.alpha).toFixed(3));
}

export { TICK_LENGTH } from "./layout.ts";
