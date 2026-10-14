import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMedia } from "../lib/media.ts";
import type { BillModel, DisplayKind } from "../lib/model.ts";
import type { View } from "../lib/router.ts";
import { type Built, MONEY_TIES } from "./graph.ts";
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

const NOUN: Record<DisplayKind, string> = {
  lobbied: "lobbying",
  traded: "stock-trade",
  funded: "PAC-money",
  voted: "vote",
  sponsored: "sponsor",
  inserted: "added-late",
};

const CROWDED = 120;
const SEEN = "antibody.howto";

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
    map: new Set<DisplayKind>(["funded", "voted", ...(built.counts.traded > CROWDED ? (["traded"] as const) : [])]),
    money: new Set(),
  }));
  const phone = useMedia("(max-width: 560px)");
  const compact = useMedia("(max-width: 980px)");
  const [folded, setFolded] = useState(true);
  const [howOpen, setHowOpen] = useState(() => {
    try {
      return !localStorage.getItem(SEEN) && !matchMedia("(max-width: 980px)").matches;
    } catch {
      return false;
    }
  });
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
      ? `${built.graph.filterNodes((_n, a) => a.malpha > 0 && a.kind === "actor").length} companies and ${built.graph.filterNodes((_n, a) => a.malpha > 0 && a.kind === "member").length} members with the most stock-trade and PAC-money ties`
      : view === "list"
        ? `${m.versions.length} text versions · ${m.sections.length} sections, with every sub-score`
        : `The ${shown.actors} best-connected companies and clients${shown.actorsTotal > shown.actors ? ` of ${shown.actorsTotal}` : ""}, the ${shown.members} best-connected members${shown.membersTotal > shown.members ? ` of ${shown.membersTotal}` : ""}`;
  const ranked = view !== "list";
  const kinds = LEGEND[mapView].filter((k) => built.counts[k] > 0);
  const on = kinds.filter((k) => !hidden[mapView].has(k));
  const off = kinds.filter((k) => hidden[mapView].has(k));
  const dashed = useMemo(() => {
    let n = 0;
    built.graph.forEachEdge((_e, a) => {
      if (
        a.inference &&
        a.views.includes(mapView) &&
        !hidden[mapView].has(a.kind) &&
        (mapView !== "money" || a.mbase > 0)
      )
        n++;
    });
    return n > 0;
  }, [built, mapView, hidden]);
  const rankedList = ranked && <Ranked m={m} view={mapView} plain={phone && folded} />;

  return (
    <section className={`stage${view === "list" ? " list" : ""}`} aria-label="X-ray">
      <div className="stage-head">
        <div className="row1">
          <div className="cap">{view === "money" ? "Money map" : "X-ray"}</div>
          <Seg view={view} setView={setView} />
        </div>
        <div className="s">{sub}</div>
      </div>
      {view !== "list" && (
        <div className={`filters${hideMap ? " off" : ""}`}>
          <span className="cap">Show</span>
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              className="lg"
              style={{ "--tone": TONE[k] } as React.CSSProperties}
              aria-pressed={!hidden[mapView].has(k)}
              onClick={() => toggle(k)}
            >
              <Swatch color={TONE[k]} />
              {NAMES[k]} <span className="n">{built.counts[k]}</span>
            </button>
          ))}
        </div>
      )}
      {view !== "list" && !hideMap && (
        <p className="showing" aria-live="polite">
          {view === "money"
            ? `Drawing the ${MONEY_TIES} strongest of ${(built.counts.traded + built.counts.funded).toLocaleString("en-US")} ties.`
            : on.length
              ? `Showing ${on.map((k) => `${built.counts[k].toLocaleString("en-US")} ${NOUN[k]}`).join(", ")} ${on.length === 1 && built.counts[on[0]!] === 1 ? "tie" : "ties"}.`
              : "Nothing is switched on."}
          {off.length > 0 &&
            ` Turn on ${off.map((k) => `${NAMES[k]} (${built.counts[k].toLocaleString("en-US")})`).join(" or ")} to see more.`}
        </p>
      )}
      {view !== "list" && !hideMap && (
        <details
          className="howto"
          open={howOpen}
          onToggle={(e) => {
            const open = e.currentTarget.open;
            if (open === howOpen) return;
            setHowOpen(open);
            try {
              localStorage.setItem(SEEN, "1");
            } catch {}
          }}
        >
          <summary>
            {view === "money"
              ? "Left: companies. Right: members. A line is a trade or PAC money."
              : "Inner ring: sections. Middle: companies and clients. Outer: members."}
            <span className="more"> What the marks mean</span>
          </summary>
          <Key view={mapView} />
        </details>
      )}
      {phone && rankedList}
      {phone && view !== "list" && (
        <button type="button" className="seemap" aria-expanded={!folded} onClick={() => setFolded(!folded)}>
          {folded ? "See the map" : "Hide the map"}
        </button>
      )}
      <div className={`stagebody${ranked && !phone && !hideMap ? " withrank" : ""}`}>
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
        {!phone && rankedList}
      </div>
      {dashed && view !== "list" && !hideMap && (
        <div className="stagefoot">
          <span className="lg static">
            <Swatch color="var(--muted)" dashed />
            dashed line: an inference, with its rule on the claim
          </span>
        </div>
      )}
    </section>
  );
}

const KEYS: Record<"map" | "money", { svg: React.ReactNode; text: string }[]> = {
  map: [
    {
      svg: <circle cx="11" cy="7" r="4" fill="var(--violet)" />,
      text: "Dot: section (§ number), company, member",
    },
    { svg: <circle cx="11" cy="7" r="6" fill="var(--gold)" opacity="0.4" />, text: "Gold glow: headline" },
    {
      svg: <circle cx="11" cy="7" r="5" fill="none" stroke="var(--red)" strokeDasharray="2 2" />,
      text: "Dashed red ring: buried candidate",
    },
    {
      svg: <circle cx="11" cy="7" r="4.5" fill="none" stroke="var(--gold)" strokeWidth="2" />,
      text: "Gold ring: sponsor",
    },
    {
      svg: <line x1="1" y1="7" x2="21" y2="7" stroke="var(--teal)" strokeWidth="2" />,
      text: "Teal line: added late",
    },
    {
      svg: <line x1="1" y1="7" x2="21" y2="7" stroke="var(--violet)" strokeWidth="2" />,
      text: "Violet line: lobbying",
    },
  ],
  money: [
    {
      svg: <line x1="1" y1="7" x2="21" y2="7" stroke="var(--steel)" strokeWidth="2" />,
      text: "Steel line: stock trades",
    },
    { svg: <line x1="1" y1="7" x2="21" y2="7" stroke="var(--gold)" strokeWidth="2" />, text: "Gold line: PAC money" },
    {
      svg: <circle cx="11" cy="7" r="5" fill="var(--violet)" />,
      text: "Bigger dot, thicker line: more trades or dollars",
    },
    {
      svg: <line x1="1" y1="7" x2="21" y2="7" stroke="var(--muted)" strokeWidth="2" strokeDasharray="3 3" />,
      text: "Dashed: an inference",
    },
  ],
};

function Key({ view }: { view: "map" | "money" }) {
  return (
    <ul className="key">
      {KEYS[view].map((k) => (
        <li key={k.text}>
          <svg viewBox="0 0 22 14" aria-hidden="true">
            {k.svg}
          </svg>
          <span>{k.text}</span>
        </li>
      ))}
    </ul>
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
