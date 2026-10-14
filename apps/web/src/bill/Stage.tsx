import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { count } from "../lib/format.ts";
import { useMedia } from "../lib/media.ts";
import { type BillModel, type DisplayKind, memberShort } from "../lib/model.ts";
import type { View } from "../lib/router.ts";
import { useFocus } from "./focus.ts";
import type { Built } from "./graph.ts";
import { MapCanvas } from "./MapCanvas.tsx";
import { Ranked } from "./Ranked.tsx";
import { Detail } from "./Tip.tsx";
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

const WHAT: Record<DisplayKind, string> = {
  lobbied: "A client reported lobbying on a section or the bill",
  traded: "A member traded the stock of a company tied to the bill. Routine disclosures, no vote claimed",
  funded: "A tied company's PAC gave money to a member",
  voted: "How each member voted on the bill",
  sponsored: "The bill's sponsor",
  inserted: "A member added this text after the first version",
};

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

  const lede = useMemo(() => {
    if (view === "list") return `${m.versions.length} text versions, ${m.sections.length} sections, every sub-score.`;
    if (view === "money") {
      const top = [...m.members].sort((a, b) => b.tradeCount - a.tradeCount)[0];
      const firms = top ? new Set(top.trades.map((t) => m.actorOf(t.dst))).size : 0;
      return `Each line is a member's stock trades in a tied company, or PAC money from one.${
        top?.tradeCount
          ? ` Most trades: ${memberShort(top.node)}, ${count(top.tradeCount, "trade")} across ${firms} ${firms === 1 ? "company" : "companies"}.`
          : ""
      }`;
    }
    return "Each line runs from a section to a company that lobbied on it, to a member tied to that company.";
  }, [m, view]);

  const ranked = view !== "list";
  const kinds = LEGEND[mapView].filter((k) => built.counts[k] > 0);
  const dashed = useMemo(() => {
    let n = 0;
    built.graph.forEachEdge((_e, a) => {
      if (
        a.inference &&
        a.views.includes(mapView) &&
        !hidden[mapView].has(a.kind) &&
        (mapView !== "money" || a.mbase > 0.1)
      )
        n++;
    });
    return n > 0;
  }, [built, mapView, hidden]);
  const pinned = view !== "list" && !hideMap && focus.pinned && built.graph.hasNode(focus.pinned) ? focus.pinned : null;
  const side = pinned ? (
    <Detail id={pinned} m={m} />
  ) : (
    ranked && <Ranked m={m} view={mapView} plain={phone && folded} />
  );

  return (
    <section className={`stage${view === "list" ? " list" : ""}`} aria-label="X-ray">
      <div className="stage-head">
        <div className="row1">
          <div className="cap">{view === "money" ? "Money map" : view === "list" ? "X-ray list" : "X-ray"}</div>
          <Seg view={view} setView={setView} />
        </div>
        <p className="s">{lede}</p>
      </div>
      {phone && ranked && <Ranked m={m} view={mapView} plain={folded} />}
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
        {!phone && !compact && side}
        {!phone && compact && ranked && !hideMap && <Ranked m={m} view={mapView} />}
      </div>
      {compact && pinned && <div className="sheet">{side}</div>}
      {view !== "list" && !hideMap && (
        <div className="stagefoot">
          <div className="filters">
            <span className="cap">Lines</span>
            {kinds.map((k) => (
              <button
                key={k}
                type="button"
                className="lg"
                title={WHAT[k]}
                style={{ "--tone": TONE[k] } as React.CSSProperties}
                aria-pressed={!hidden[mapView].has(k)}
                onClick={() => toggle(k)}
              >
                <Swatch color={TONE[k]} />
                {NAMES[k]} <span className="n">{built.counts[k].toLocaleString("en-US")}</span>
              </button>
            ))}
          </div>
          <details className="howto" open={!phone}>
            <summary>How to read this map</summary>
            <Key view={mapView} dashed={dashed} />
          </details>
        </div>
      )}
    </section>
  );
}

const mark = (node: React.ReactNode) => (
  <svg viewBox="0 0 22 14" aria-hidden="true">
    {node}
  </svg>
);

const KEYS: Record<"map" | "money", { svg: React.ReactNode; text: string }[]> = {
  map: [
    { svg: mark(<rect x="6" y="2" width="10" height="10" rx="2" fill="var(--violet)" />), text: "Company or client" },
    {
      svg: mark(
        <>
          <circle cx="6" cy="7" r="4.5" fill="var(--violet)" />
          <circle cx="16.5" cy="7" r="4" fill="none" stroke="var(--violet)" strokeWidth="1.6" />
        </>,
      ),
      text: "Member: filled voted yea, hollow nay or no vote",
    },
    {
      svg: mark(
        <>
          <circle cx="11" cy="7" r="5.5" fill="var(--violet)" opacity="0.5" />
          <text x="11" y="9.8" textAnchor="middle" fontSize="7" fontWeight="700" fill="var(--text)">
            4
          </text>
        </>,
      ),
      text: "Numbered dot: section",
    },
    {
      svg: mark(<circle cx="11" cy="7" r="5" fill="none" stroke="var(--gold)" strokeWidth="2" />),
      text: "Gold ring: sponsor",
    },
    {
      svg: mark(<circle cx="11" cy="7" r="6" fill="var(--gold)" opacity="0.4" />),
      text: "Gold glow: headline section",
    },
    {
      svg: mark(<circle cx="11" cy="7" r="5.2" fill="none" stroke="var(--red)" strokeDasharray="2 2" />),
      text: "Dashed red ring: buried candidate",
    },
  ],
  money: [
    { svg: mark(<rect x="6" y="2" width="10" height="10" rx="2" fill="var(--violet)" />), text: "Company" },
    {
      svg: mark(
        <>
          <circle cx="6" cy="7" r="4.5" fill="var(--violet)" />
          <circle cx="16.5" cy="7" r="4" fill="none" stroke="var(--violet)" strokeWidth="1.6" />
        </>,
      ),
      text: "Member: filled voted yea, hollow nay or no vote",
    },
    {
      svg: mark(<circle cx="11" cy="7" r="6" fill="var(--violet)" />),
      text: "Bigger mark, thicker line: more trades or dollars",
    },
  ],
};

function Key({ view, dashed }: { view: "map" | "money"; dashed: boolean }) {
  const items = dashed
    ? [
        ...KEYS[view],
        {
          svg: mark(<line x1="1" y1="7" x2="21" y2="7" stroke="var(--muted)" strokeWidth="2" strokeDasharray="3 3" />),
          text: "Dashed line: an inference, rule on its claim",
        },
      ]
    : KEYS[view];
  return (
    <ul className="key">
      {items.map((k) => (
        <li key={k.text}>
          {k.svg}
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
