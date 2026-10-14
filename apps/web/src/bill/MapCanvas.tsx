import { layerBorder } from "@sigma/node-border";
import { useEffect, useMemo, useRef, useState } from "react";
import Sigma from "sigma";
import { layerDashed, layerPlain, pathCurved, pathLine, sdfCircle, sdfDiamond, sdfSquare } from "sigma/rendering";
import { animateNodes } from "sigma/utils";
import type { BillModel, DisplayKind } from "../lib/model.ts";
import { type Palette, palette, useTheme } from "../lib/theme.ts";
import { Fit } from "../ui/icons.tsx";
import { useFocus } from "./focus.ts";
import {
  type Built,
  type EdgeAttrs,
  type GS,
  type NodeAttrs,
  type NS,
  RADIUS,
  type Renderer,
  RING,
  targetsFor,
} from "./graph.ts";
import { Tip } from "./Tip.tsx";

const MONO = "JetBrains Mono Variable";
const BOX = RADIUS + 12;

type MapView = "map" | "money";

interface Env {
  pal: Palette;
  view: MapView;
  hidden: Set<DisplayKind>;
}

const rgba = (hex: string, a: number) => {
  if (a >= 1) return hex;
  const h = hex.replace("#", "");
  const n = Number.parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, a).toFixed(3)})`;
};

interface Props {
  m: BillModel;
  built: Built;
  view: MapView;
  hidden: Set<DisplayKind>;
  active: boolean;
}

export function MapCanvas({ m, built, view, hidden, active }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const back = useRef<SVGGElement>(null);
  const front = useRef<SVGGElement>(null);
  const tipAnchor = useRef<(() => void) | null>(null);
  const [sigma, setSigma] = useState<Renderer | null>(null);
  const [moved, setMoved] = useState(false);
  const theme = useTheme();
  const focus = useFocus();
  const env = useRef<Env>({ pal: palette(), view, hidden });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let renderer: Renderer | null = null;
    let dead = false;
    const coarse = matchMedia("(pointer: coarse)").matches;
    document.fonts.load(`500 10px "${MONO}"`).finally(() => {
      if (dead) return;
      const E = env.current;
      const dim = (focused: boolean, isActive: boolean) => (focused && !isActive ? 0.12 : 1);
      // sigma 4's style typings collapse to `never` under TypeScript 7 (ExtractBaseType infers nothing), so the
      // style functions are typed by hand below and the declaration is passed through untyped.
      const r: Renderer = new Sigma(built.graph, el, {
        customNodeState: { isActive: false },
        customEdgeState: { isActive: false },
        customGraphState: { focused: false, tick: 0 },
        primitives: {
          nodes: {
            shapes: [sdfCircle(), sdfSquare({ cornerRadius: 0.18 }), sdfDiamond({ cornerRadius: 0.12 })],
            variables: {
              fillColor: { type: "color", default: "transparent" },
              borderColor: { type: "color", default: "transparent" },
              borderSize: { type: "number", default: 0 },
            },
            layers: [
              layerBorder({
                borders: [
                  { size: { attribute: "borderSize" }, color: { attribute: "borderColor" }, mode: "relative" },
                  { size: 0, color: { attribute: "fillColor" }, fill: true },
                ],
              }),
            ],
            label: { font: { family: MONO, weight: "500" }, margin: 4 },
          },
          edges: {
            paths: [pathLine(), pathCurved({ curvature: { attribute: "curvature" } })],
            variables: {
              solid: { type: "color", default: "transparent" },
              dashColor: { type: "color", default: "transparent" },
              dash: { type: "number", default: 0 },
            },
            layers: [
              layerPlain({ color: { attribute: "solid" } }),
              layerDashed({
                dashColor: { attribute: "dashColor" },
                dashSize: { attribute: "dash" },
                gapSize: { value: 3 },
              }),
            ],
          },
        },
        styles: {
          nodes: {
            x: { attribute: "x" },
            y: { attribute: "y" },
            size: { attribute: "size" },
            shape: { attribute: "shape" },
            color: (a: NodeAttrs) => E.pal[a.tone],
            fillColor: (a: NodeAttrs, s: NS, gs: GS) =>
              rgba(E.pal[a.tone], a.fillAlpha * a.alpha * dim(gs.focused, s.isActive)),
            borderColor: (a: NodeAttrs, s: NS, gs: GS) => rgba(E.pal[a.border], a.alpha * dim(gs.focused, s.isActive)),
            borderSize: { attribute: "borderSize" },
            label: { attribute: "label" },
            labelFont: MONO,
            labelSize: (a: NodeAttrs) => (a.kind === "section" ? 9 : 10),
            labelColor: (a: NodeAttrs, s: NS, gs: GS) =>
              rgba(E.pal[a.labelTone], Math.min(1, a.alpha * 1.4) * dim(gs.focused, s.isActive)),
            labelPosition: (a: NodeAttrs) =>
              a.kind === "section" || a.kind === "bill" ? "over" : E.view === "money" ? a.mlabel : a.rlabel,
            labelVisibility: (a: NodeAttrs, s: NS, gs: GS) =>
              a.alpha < 0.5 || (gs.focused && !s.isActive)
                ? "hidden"
                : s.isActive || s.isHovered || a.important
                  ? "visible"
                  : "auto",
            visibility: (a: NodeAttrs) => (a.alpha < 0.02 ? "hidden" : "visible"),
            depth: (_a: NodeAttrs, s: NS) => (s.isActive || s.isHovered ? "topNodes" : "nodes"),
            zIndex: (a: NodeAttrs) => (a.kind === "bill" ? 2 : a.kind === "section" ? 1 : 0),
            cursor: "pointer",
          },
          edges: {
            path: (e: EdgeAttrs) => (e.curvature ? "curved" : "straight"),
            curvature: { attribute: "curvature" },
            size: (e: EdgeAttrs, s: NS) => e.width * (s.isActive ? 1.7 : 1),
            color: (e: EdgeAttrs) => E.pal[e.tone],
            solid: (e: EdgeAttrs, s: NS, gs: GS) =>
              e.inference ? "transparent" : rgba(E.pal[e.tone], edgeAlpha(E, e, s.isActive, gs.focused)),
            dashColor: (e: EdgeAttrs, s: NS, gs: GS) =>
              e.inference ? rgba(E.pal[e.tone], edgeAlpha(E, e, s.isActive, gs.focused)) : "transparent",
            dash: (e: EdgeAttrs) => (e.inference ? 4 : 0),
            visibility: (e: EdgeAttrs, s: NS, gs: GS) =>
              edgeAlpha(E, e, s.isActive, gs.focused) > 0 ? "visible" : "hidden",
            depth: (_e: EdgeAttrs, s: NS) => (s.isActive ? "topEdges" : "edges"),
          },
        } as never,
        settings: {
          itemSizesReference: "positions",
          zoomToSizeRatioFunction: (r) => r,
          autoRescale: true,
          stagePadding: 18,
          minEdgeThickness: 0.6,
          enableCameraRotation: false,
          enableCameraMouseRotation: false,
          minCameraRatio: 0.18,
          maxCameraRatio: 1.6,
          gestureTarget: coarse ? "shared" : "graph",
          labelRenderedSizeThreshold: 5,
          labelDensity: 1.4,
          labelGridCellSize: 60,
          nodePickingPadding: 3,
        },
      });
      r.setCustomBBox({ x: [-BOX, BOX], y: [-BOX, BOX] });
      renderer = r;
      setSigma(r);
    });
    return () => {
      dead = true;
      renderer?.kill();
      setSigma(null);
    };
  }, [built]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: palette() reads the CSS color tokens, which change with the theme
  useEffect(() => {
    env.current.pal = palette();
    if (sigma) sigma.setGraphState({ tick: sigma.getGraphState().tick + 1 });
  }, [theme, sigma]);

  useEffect(() => {
    env.current.hidden = hidden;
    if (sigma) sigma.setGraphState({ tick: sigma.getGraphState().tick + 1 });
  }, [hidden, sigma]);

  useEffect(() => {
    if (!sigma) return;
    const g = built.graph;
    env.current.view = view;
    sigma.setGraphState({ tick: sigma.getGraphState().tick + 1 });
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const targets = targetsFor(g, view);
    if (reduce) {
      for (const [n, t] of Object.entries(targets)) g.mergeNodeAttributes(n, t);
      return;
    }
    return animateNodes(g, targets, { duration: 700, easing: "cubicInOut" });
  }, [view, sigma, built]);

  useEffect(() => {
    if (!sigma) return;
    const el = box.current!;
    const ro = new ResizeObserver(() => sigma.resize(true).refresh());
    ro.observe(el);
    const place = () => {
      const c = sigma.graphToViewport({ x: 0, y: 0 });
      const e = sigma.graphToViewport({ x: RADIUS, y: 0 });
      const k = (e.x - c.x) / RADIUS;
      const t = `translate(${c.x.toFixed(2)} ${c.y.toFixed(2)}) scale(${k.toFixed(5)})`;
      back.current?.setAttribute("transform", t);
      front.current?.setAttribute("transform", t);
      tipAnchor.current?.();
    };
    sigma.on("afterRender", place);
    const cam = sigma.getCamera();
    const onCam = () => {
      const s = cam.getState();
      setMoved(Math.abs(s.ratio - 1) > 0.02 || Math.abs(s.x - 0.5) > 0.01 || Math.abs(s.y - 0.5) > 0.01);
    };
    cam.on("updated", onCam);
    sigma.on("enterNode", ({ node }) => focus.setHover(node));
    sigma.on("leaveNode", () => focus.setHover(null));
    sigma.on("clickNode", ({ node }) => focus.pin(node));
    sigma.on("clickStage", () => focus.pin(null));
    place();
    return () => {
      ro.disconnect();
      sigma.removeAllListeners();
      cam.removeListener("updated", onCam);
    };
  }, [sigma, focus.setHover, focus.pin]);

  const target = active ? (focus.pinned ?? focus.hover) : null;
  const shownTarget =
    target && built.graph.hasNode(target) && built.graph.getNodeAttribute(target, "alpha") > 0.5 ? target : null;

  useEffect(() => {
    if (!sigma) return;
    const g = built.graph;
    const nodes = new Set<string>();
    const edges = new Set<string>();
    if (shownTarget) {
      nodes.add(shownTarget);
      const E = env.current;
      const visible = (e: string) => edgeAlpha(E, g.getEdgeAttributes(e), false, false) > 0;
      if (shownTarget === m.billNode) {
        g.forEachInEdge(shownTarget, (e, a, src) => {
          if (a.kind === "lobbied" && visible(e)) {
            edges.add(e);
            nodes.add(src);
          }
        });
        g.forEachNode((n, a) => a.kind === "section" && nodes.add(n));
      } else {
        g.forEachEdge(shownTarget, (e, _a, src, dst) => {
          if (!visible(e)) return;
          edges.add(e);
          nodes.add(src === shownTarget ? dst : src);
        });
      }
    }
    g.forEachNode((n) => {
      const on = nodes.has(n);
      if (sigma.getNodeState(n).isActive !== on) sigma.setNodeState(n, { isActive: on });
    });
    g.forEachEdge((e) => {
      const on = edges.has(e);
      if (sigma.getEdgeState(e).isActive !== on) sigma.setEdgeState(e, { isActive: on });
    });
    sigma.setGraphState({ focused: !!shownTarget, tick: sigma.getGraphState().tick + 1 });
  }, [shownTarget, sigma, built, m.billNode]);

  useEffect(() => {
    if (!active || !focus.pinned) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && focus.pin(null);
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [active, focus.pinned, focus.pin]);

  const rings = view === "map";
  return (
    <>
      <div className="canvas">
        <svg className="overlay back" aria-hidden="true">
          <g ref={back}>
            <g className={`rings${rings ? "" : " off"}`}>
              <Donut r0={RING.members[0]} r1={RING.members[1]} fill="var(--band-3)" />
              <Donut r0={RING.actors[0]} r1={RING.actors[1]} fill="var(--band-2)" />
              <Donut r0={RING.sections[0]} r1={RING.sections[1]} fill="var(--band-1)" />
              {built.stages.map((s) => (
                <circle
                  key={s.code}
                  r={s.r}
                  fill="none"
                  stroke="var(--line-2)"
                  strokeDasharray="1 4"
                  strokeWidth={0.8}
                />
              ))}
              <Halos m={m} built={built} />
              <Seal />
            </g>
          </g>
        </svg>
        <div className="sigma" ref={box} />
        <svg className="overlay front" aria-hidden="true">
          <g ref={front}>
            <g className={`rings${rings ? "" : " off"}`}>
              <ArcLabel id="al-sec" r={RING.sections[1] + 3} text="Sections · ring = stage added" />
              <ArcLabel id="al-act" r={RING.actors[1] + 3} text="Who lobbied · tied companies" />
              <ArcLabel id="al-mem" r={RING.members[1] + 5} text="Members · traded, funded or sponsored" />
              {built.stages.length > 1 &&
                built.stages.map((s, i) => (
                  <ArcLabel key={s.code} id={`al-st${i}`} r={s.r} text={stageShort(s.name, s.code)} small span={11} />
                ))}
              <BillBadge m={m} />
            </g>
          </g>
        </svg>
      </div>
      {sigma && shownTarget && (
        <Tip
          key={shownTarget}
          id={shownTarget}
          m={m}
          sigma={sigma}
          pinned={focus.pinned === shownTarget}
          anchorRef={tipAnchor}
        />
      )}
      <button
        type="button"
        className={`iconbtn reset${moved ? " show" : ""}`}
        aria-label="Fit the map"
        onClick={() =>
          sigma?.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1, angle: 0 }, { duration: 450, easing: "cubicInOut" })
        }
      >
        <Fit />
      </button>
    </>
  );
}

function edgeAlpha(E: Env, e: EdgeAttrs, isActive: boolean, focused: boolean) {
  if (!e.views.includes(E.view) || E.hidden.has(e.kind)) return 0;
  if (focused) return isActive ? 0.92 : 0;
  return E.view === "money" ? Math.min(0.75, e.base * 1.6) : e.base;
}

const stageShort = (name: string, code: string) => {
  if (/predecessor/i.test(name)) return name.split(" ")[0]!;
  const map: Record<string, string> = {
    ih: "intro",
    is: "intro",
    rh: "cmte",
    rs: "cmte",
    pcs: "cmte",
    pch: "cmte",
    eh: "floor",
    es: "floor",
    eah: "conf",
    eas: "conf",
    enr: "final",
  };
  return map[code] ?? code;
};

function Donut({ r0, r1, fill }: { r0: number; r1: number; fill: string }) {
  return (
    <path
      d={`M${-r1},0a${r1},${r1} 0 1,0 ${2 * r1},0a${r1},${r1} 0 1,0 ${-2 * r1},0ZM${-r0},0a${r0},${r0} 0 1,1 ${2 * r0},0a${r0},${r0} 0 1,1 ${-2 * r0},0Z`}
      fill={fill}
      fillRule="evenodd"
    />
  );
}

function ArcLabel({
  id,
  r,
  text,
  small = false,
  span,
}: {
  id: string;
  r: number;
  text: string;
  small?: boolean;
  span?: number;
}) {
  const half = span ?? 34;
  const a0 = ((-90 - half) * Math.PI) / 180;
  const a1 = ((-90 + half) * Math.PI) / 180;
  const p = (a: number) => `${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`;
  return (
    <>
      <defs>
        <path id={id} d={`M${p(a0)}A${r},${r} 0 0,1 ${p(a1)}`} fill="none" />
      </defs>
      <text className={`ringlabel${small ? " small" : ""}`} dy={small ? 2.5 : -4}>
        <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
          {text}
        </textPath>
      </text>
    </>
  );
}

function Seal() {
  const d = useMemo(() => {
    const teeth = 28;
    let s = "";
    for (let i = 0; i <= teeth * 2; i++) {
      const a = (i / (teeth * 2)) * Math.PI * 2;
      const r = i % 2 ? RING.badge - 5 : RING.badge;
      s += `${i ? "L" : "M"}${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
    }
    return `${s}Z`;
  }, []);
  return <path d={d} fill="var(--seal)" stroke="var(--red)" strokeWidth={1.4} />;
}

function BillBadge({ m }: { m: BillModel }) {
  const { bill } = m.b;
  const name = bill.shortTitle ?? bill.display;
  const size = name.length > 14 ? 11.5 : 15.5;
  return (
    <g style={{ pointerEvents: "none" }}>
      <text y={-13} textAnchor="middle" fontSize={11} fontFamily="var(--mono)" fontWeight={600} fill="var(--red)">
        {bill.display}
      </text>
      <text y={5} textAnchor="middle" fontSize={size} fontWeight={600} fill="var(--text)" fontFamily="var(--sans)">
        {name.length > 22 ? `${name.slice(0, 21)}…` : name}
      </text>
      <text y={21} textAnchor="middle" fontSize={9.5} fontFamily="var(--mono)" fill="var(--muted)">
        {bill.law ?? (bill.latestAction ? "in Congress" : "")}
      </text>
    </g>
  );
}

function Halos({ m, built }: { m: BillModel; built: Built }) {
  const g = built.graph;
  return (
    <>
      {m.sections
        .filter((v) => v.kind === "headline" || v.kind === "buried")
        .map((v) => {
          const id = `section:${v.s.id}`;
          if (!g.hasNode(id)) return null;
          const a = g.getNodeAttributes(id);
          return v.kind === "headline" ? (
            <circle key={id} cx={a.rx} cy={a.ry} r={a.rsize + 6} fill="var(--gold)" opacity={0.22} />
          ) : (
            <circle
              key={id}
              cx={a.rx}
              cy={a.ry}
              r={a.rsize + 6}
              fill="none"
              stroke="var(--red)"
              strokeWidth={1.4}
              strokeDasharray="2 2"
            />
          );
        })}
    </>
  );
}
