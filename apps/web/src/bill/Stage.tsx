import { useLayoutEffect, useRef, useState } from "react";
import { useMedia } from "../lib/media.ts";
import type { BillModel, DisplayKind } from "../lib/model.ts";
import type { View } from "../lib/router.ts";
import { ThemeButton } from "../ui/ThemeButton.tsx";
import { useFocus } from "./focus.ts";
import type { Built } from "./graph.ts";
import { MapCanvas } from "./MapCanvas.tsx";
import { Ranked } from "./Ranked.tsx";
import { XrayList } from "./XrayList.tsx";

const NAMES: Record<DisplayKind, string> = {
  lobbied: "lobbied",
  traded: "traded stock (routine)",
  funded: "PAC money",
  voted: "voted",
  sponsored: "sponsor",
  inserted: "added late",
};
const TONE: Record<DisplayKind, string> = {
  lobbied: "var(--violet)",
  traded: "var(--steel)",
  funded: "var(--gold)",
  voted: "var(--grey)",
  sponsored: "var(--gold)",
  inserted: "var(--teal)",
};
const LEGEND: Record<"map" | "money", DisplayKind[]> = {
  map: ["lobbied", "traded", "funded", "voted", "sponsored", "inserted"],
  money: ["traded", "funded"],
};

const CROWDED = 120;

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
  const [hidden, setHidden] = useState<Record<"map" | "money", Set<DisplayKind>>>(() => ({
    map: new Set<DisplayKind>([
      "funded",
      "voted",
      ...(built.counts.traded > CROWDED ? (["traded"] as const) : []),
      ...(built.counts.inserted > CROWDED / 4 ? (["inserted"] as const) : []),
    ]),
    money: new Set(),
  }));
  const phone = useMedia("(max-width: 560px)");
  const compact = useMedia("(max-width: 980px)");
  const [folded, setFolded] = useState(true);
  const focus = useFocus();
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
  const sub =
    view === "money"
      ? `${built.graph.filterNodes((_n, a) => a.malpha > 0 && a.kind === "actor").length} companies and ${built.graph.filterNodes((_n, a) => a.malpha > 0 && a.kind === "member").length} members joined by stock trades or PAC money`
      : view === "list"
        ? `${m.versions.length} text versions · ${m.sections.length} sections, with every sub-score`
        : `The ${shown.actors} best-connected companies and clients${shown.actorsTotal > shown.actors ? ` of ${shown.actorsTotal}` : ""}, the ${shown.members} best-connected members${shown.membersTotal > shown.members ? ` of ${shown.membersTotal}` : ""}`;
  const ranked = view === "money" || (compact && view !== "list");

  return (
    <section className={`stage${view === "list" ? " list" : ""}`} aria-label="X-ray">
      <div className="stage-head">
        <div className="cap">
          {view === "money" ? "Money map" : "X-ray"}: {m.b.bill.display} {m.b.bill.shortTitle ?? ""}
        </div>
        <div className="s">{sub}</div>
      </div>
      <ThemeButton className="iconbtn theme" />
      {view !== "list" && (
        <div className={`filters${hideMap ? " off" : ""}`}>
          <span className="cap">Show</span>
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
        </div>
      )}
      {view === "map" && !hideMap && (
        <details className="howto">
          <summary>How to read this map</summary>
          <p>
            <b>Outer ring:</b> members who traded, were funded or sponsored. <b>Middle ring:</b> companies and lobbying
            clients. <b>Inner ring:</b> the bill’s sections; the further out, the later the text they first appeared in.
            A gold glow marks a headline section, a dashed red ring a buried candidate, a gold ring the sponsor. Teal
            lines are sections added after the first text.
          </p>
        </details>
      )}
      {view === "money" && (
        <details className="howto">
          <summary>How to read this map</summary>
          <p>
            <b>Left:</b> companies. <b>Right:</b> members. A line is a stock trade (steel) or PAC money (gold); thicker
            and darker means more trades or dollars, and a bigger dot means more of either. Trades are routine
            disclosures; no link to any vote is claimed.
          </p>
        </details>
      )}
      {phone && view !== "list" && (
        <button type="button" className="seemap" aria-expanded={!folded} onClick={() => setFolded(!folded)}>
          {folded ? "See the map" : "Hide the map"}
        </button>
      )}
      <div className={`stagebody${ranked && !hideMap ? " withrank" : ""}`}>
        <div className={`mapwrap${hideMap ? " off" : ""}`}>
          <MapCanvas
            m={m}
            built={built}
            view={mapView}
            hidden={hidden[mapView]}
            active={!hideMap}
            fixed={compact}
            labels={phone ? 0 : compact ? 12 : 26}
          />
        </div>
        {view === "list" && <XrayList m={m} />}
        {ranked && !hideMap && <Ranked m={m} />}
      </div>
      <div className="stagefoot">
        {view !== "list" && !hideMap && (
          <span className="lg static">
            <Swatch color="var(--muted)" dashed />
            dashed: inference
          </span>
        )}
        {view !== "list" && !hideMap && (
          <span className="hint">
            {focus.pinned
              ? "Esc or click empty space to clear"
              : compact
                ? "Tap a dot for its ties"
                : "Click a dot to see only its ties"}
          </span>
        )}
        <Seg view={view} setView={setView} />
      </div>
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
