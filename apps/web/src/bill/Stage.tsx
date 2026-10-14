import { useLayoutEffect, useRef, useState } from "react";
import { useMedia } from "../lib/media.ts";
import type { BillModel, DisplayKind } from "../lib/model.ts";
import type { View } from "../lib/router.ts";
import { ThemeButton } from "../ui/ThemeButton.tsx";
import type { Built } from "./graph.ts";
import { MapCanvas } from "./MapCanvas.tsx";
import { XrayList } from "./XrayList.tsx";

const NAMES: Record<DisplayKind, string> = {
  lobbied: "lobbied",
  traded: "traded stock",
  funded: "PAC money",
  voted: "voted",
  sponsored: "sponsor",
  inserted: "inserted",
};
const TONE: Record<DisplayKind, string> = {
  lobbied: "var(--violet)",
  traded: "var(--red)",
  funded: "var(--gold)",
  voted: "var(--grey)",
  sponsored: "var(--gold)",
  inserted: "var(--gold)",
};
const LEGEND: Record<"map" | "money", DisplayKind[]> = {
  map: ["lobbied", "traded", "funded", "voted", "sponsored", "inserted"],
  money: ["traded", "funded"],
};

const VIEWS: [View, string][] = [
  ["map", "Map"],
  ["money", "Money map"],
  ["list", "X-ray list"],
];

interface Props {
  m: BillModel;
  built: Built;
  view: View;
  setView: (v: View) => void;
}

export function Stage({ m, built, view, setView }: Props) {
  const [hidden, setHidden] = useState<Record<"map" | "money", Set<DisplayKind>>>({
    map: new Set(["funded", "voted"]),
    money: new Set(),
  });
  const phone = useMedia("(max-width: 560px)");
  const [folded, setFolded] = useState(true);
  const hideMap = view === "list" || (phone && folded);
  const mapView = view === "money" ? "money" : "map";
  const toggle = (k: DisplayKind) =>
    setHidden((h) => {
      const next = new Set(h[mapView]);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return { ...h, [mapView]: next };
    });

  const { shown } = built;
  const traded = m.members.filter((v) => v.tradeCount).length;
  const sub =
    view === "money"
      ? `${built.graph.filterNodes((_n, a) => a.malpha > 0 && a.kind === "actor").length} companies and ${built.graph.filterNodes((_n, a) => a.malpha > 0 && a.kind === "member").length} members joined by stock trades or PAC money`
      : view === "list"
        ? `${m.versions.length} text versions · ${m.sections.length} sections, with every sub-score`
        : `${shown.sections} sections · ${shown.actors}${shown.actorsTotal > shown.actors ? ` of ${shown.actorsTotal}` : ""} lobbying clients and tied companies · ${shown.members}${shown.membersTotal > shown.members ? ` of ${shown.membersTotal}` : ""} members (${traded} traded)`;

  return (
    <section className={`stage${view === "list" ? " list" : ""}`} aria-label="X-ray">
      <div className="stage-head">
        <div className="cap">
          {view === "money" ? "Money map" : "X-ray"}: {m.b.bill.display} {m.b.bill.shortTitle ?? ""}
        </div>
        <div className="s">{sub}</div>
      </div>
      <ThemeButton className="iconbtn theme" />
      {phone && view !== "list" && (
        <button type="button" className="seemap" aria-expanded={!folded} onClick={() => setFolded(!folded)}>
          {folded ? "See the map" : "Hide the map"}
        </button>
      )}
      <div className={`mapwrap${hideMap ? " off" : ""}`}>
        <MapCanvas m={m} built={built} view={mapView} hidden={hidden[mapView]} active={!hideMap} />
      </div>
      {view === "list" && <XrayList m={m} />}
      <div className={`legend${hideMap ? " off" : ""}`}>
        <div className="cap">Edges · click to toggle</div>
        <div className="items">
          {LEGEND[mapView]
            .filter((k) => built.counts[k] > 0)
            .map((k) => (
              <button
                key={k}
                type="button"
                className="lg"
                aria-pressed={!hidden[mapView].has(k)}
                onClick={() => toggle(k)}
              >
                <Swatch color={TONE[k]} />
                {NAMES[k]} <span className="n">{built.counts[k]}</span>
              </button>
            ))}
          <span className="lg static">
            <Swatch color="var(--muted)" dashed />
            dashed = inference
          </span>
        </div>
      </div>
      <Seg view={view} setView={setView} />
    </section>
  );
}

function Swatch({ color, dashed = false }: { color: string; dashed?: boolean }) {
  return (
    <svg viewBox="0 0 22 8" aria-hidden="true">
      <line
        x1="1"
        y1="4"
        x2="21"
        y2="4"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={dashed ? "3 3" : undefined}
      />
    </svg>
  );
}

function Seg({ view, setView }: { view: View; setView: (v: View) => void }) {
  const wrap = useRef<HTMLFieldSetElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const btn = wrap.current?.querySelector<HTMLButtonElement>(`[data-view="${view}"]`);
      if (btn) setThumb({ left: btn.offsetLeft, width: btn.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [view]);
  return (
    <fieldset className="seg" aria-label="View" ref={wrap}>
      {thumb && <span className="thumb" style={thumb} />}
      {VIEWS.map(([v, label]) => (
        <button key={v} type="button" data-view={v} aria-pressed={view === v} onClick={() => setView(v)}>
          {label}
        </button>
      ))}
    </fieldset>
  );
}
