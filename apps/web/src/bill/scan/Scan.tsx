import { type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { count } from "../../lib/format.ts";
import { useMedia } from "../../lib/media.ts";
import type { BillModel } from "../../lib/model.ts";
import { Card, CompactCard } from "./Card.tsx";
import { type CardData, groupCard, memberCard, money, pacCard, tradesCard } from "./cards.ts";
import { buildScenes, emptiness, itemIds, type MapView, present, type Scenes } from "./layout.ts";
import { Ring, type RingHandle } from "./Ring.tsx";
import { Sheet } from "./Sheet.tsx";
import { ViewSwitch } from "./Switch.tsx";
import { CARD_SPRING, springEasing } from "./spring.ts";
import "./scan.css";

export interface ScanProps {
  m: BillModel;
  claimsLoaded?: boolean;
  focus: string | null;
  setFocus: (id: string | null) => void;
  mapView: MapView;
  setMapView: (v: MapView) => void;
}

const CARD_EASE = springEasing(CARD_SPRING);
const SWITCH_EASE = springEasing({ zeta: 1, response: 0.4 });

const TITLES: Record<MapView, string> = {
  trades: "Who is tied to this bill",
  pac: "Who gave money",
  sections: "What each section costs",
};

function cardFor(m: BillModel, s: Scenes, view: MapView, id: string): CardData | null {
  if (id.startsWith("group:")) {
    const g = s.groups.find((x) => x.id === id);
    return g && view === "sections" ? groupCard(g) : null;
  }
  if (view === "sections") return null;
  if (id.startsWith("member:")) {
    const v = m.memberById.get(id);
    const ties = s.ring[view].data.byMember.get(id);
    return v && ties ? memberCard(m, v, view, ties) : null;
  }
  const a = m.actorById.get(id);
  if (!a) return null;
  const ties = s.allTies[view].get(id) ?? [];
  return view === "trades" ? tradesCard(m, a, ties) : pacCard(m, a, ties);
}

interface Pick {
  id: string;
  name: string;
  meta: string;
}

function picksFor(m: BillModel, s: Scenes, view: MapView): Pick[] {
  if (view === "sections")
    return [...s.groups]
      .map((g) => groupCard(g))
      .sort((a, b) => Math.abs(b.netMusd) - Math.abs(a.netMusd))
      .slice(0, 5)
      .map((c) => ({ id: c.id, name: c.name, meta: count(c.count, "section") }));
  const { data } = s.ring[view];
  return data.companies.slice(0, 5).map((a) => {
    const n = data.byCompany.get(a.id) ?? [];
    return {
      id: a.id,
      name: a.short,
      meta: view === "trades" ? count(n.length, "member") : money(n.reduce((t, x) => t + x.weight, 0)),
    };
  });
}

interface Copy {
  title: string;
  intro: string;
  notes: string[];
}

function copyFor(m: BillModel, s: Scenes, view: MapView): Copy {
  const n = s.finalSections;
  if (view === "sections") {
    const notes = [`${s.figures} of ${count(n, "section")} have a CBO figure.`];
    if (s.sections.some((x) => x.estimate))
      notes.push("Dashed bars split a group figure evenly across its sections, which is an inference.");
    return {
      title: TITLES.sections,
      intro:
        "Each bar is one section, grouped by the title of the bill it sits in. The longer the bar, the more CBO says it costs; each ring is ten times the last. Faded bars save money. Short stubs have no CBO figure.",
      notes,
    };
  }
  const { data } = s.ring[view];
  const cut = data.candidates.companies > data.companies.length;
  if (view === "pac")
    return {
      title: TITLES.pac,
      intro:
        "Same ring, different tie. The middle ring is the companies whose political action committees gave to members of Congress before they voted on the bill, sized by how much. The outer ring is every member who got some. Pick a company to see who it gave to.",
      notes: [
        "Each PAC is matched to its company by a published rule, so these ties are inferences and drawn dashed.",
        ...(cut
          ? [`Showing the ${data.companies.length} of ${data.candidates.companies} companies with the most PAC money.`]
          : []),
      ],
    };
  return {
    title: TITLES.trades,
    intro: `The bill sits in the middle, ringed by its ${count(n, "section")}. Around them are the companies that lobbied on it, and on the outside the members of Congress who traded those companies’ stock. Pick any company to light up its ties.`,
    notes: cut
      ? [
          `Showing the ${data.companies.length} of ${data.candidates.companies} companies with the most members trading their stock.`,
        ]
      : [],
  };
}

function useReveal(ref: React.RefObject<Element | null>, reduced: boolean): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen]);
  return seen || reduced;
}

interface SlotProps {
  id: string | null;
  instant: boolean;
  originOf: (id: string) => { x: number; y: number } | null;
  render: (id: string) => ReactNode;
  idle: ReactNode;
}

/** The card slot: a card grows out of the mark that was clicked, and the one it replaces fades away underneath. */
function CardSlot({ id, instant, originOf, render, idle }: SlotProps) {
  const last = useRef<{ id: string; node: ReactNode } | null>(null);
  const [leaving, setLeaving] = useState<{ id: string; node: ReactNode }[]>([]);
  const node = id ? render(id) : null;

  useLayoutEffect(() => {
    const was = last.current;
    if (was && was.id !== id) {
      setLeaving((l) => [...l, was]);
      setTimeout(() => setLeaving((l) => l.filter((x) => x !== was)), 170);
    }
    last.current = id && node ? { id, node } : null;
  });

  return (
    <div className="sc-slot" data-keep>
      {leaving.map((l) => (
        <div key={`out-${l.id}`} className="sc-card-wrap sc-leaving" aria-hidden="true" inert>
          {l.node}
        </div>
      ))}
      {id && node ? (
        <Enter key={id} id={id} instant={instant} originOf={originOf}>
          {node}
        </Enter>
      ) : (
        <div className="sc-card-wrap sc-fade">{idle}</div>
      )}
    </div>
  );
}

function Enter({
  id,
  instant,
  originOf,
  children,
}: {
  id: string;
  instant: boolean;
  originOf: SlotProps["originOf"];
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || instant) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "linear" });
      return;
    }
    const o = originOf(id);
    const box = el.getBoundingClientRect();
    el.style.transformOrigin = o ? `${Math.round(o.x - box.left)}px ${Math.round(o.y - box.top)}px` : "50% 0";
    el.animate(
      [
        { transform: "scale(0.96)", opacity: 0, filter: "blur(6px)" },
        { transform: "scale(1)", opacity: 1, filter: "blur(0px)" },
      ],
      { duration: CARD_EASE.duration, easing: CARD_EASE.easing },
    );
  }, [id, instant, originOf]);
  return (
    <div ref={ref} className="sc-card-wrap">
      {children}
    </div>
  );
}

function Picks({
  picks,
  view,
  onPick,
  compact,
}: {
  picks: Pick[];
  view: MapView;
  onPick: (id: string) => void;
  compact?: boolean;
}) {
  const noun = view === "sections" ? "title" : "company";
  return (
    <aside className={`sc-card sc-idle${compact ? " sc-compact" : ""}`} aria-label={`Pick a ${noun}`}>
      <h3>Pick a {noun}</h3>
      <p className="sc-sum">
        {compact
          ? `Tap a ${noun} on the ring to see who is tied to it.`
          : `Point at a ${noun} on the ring to light up its ties, or click to keep it open. Or start with one of these.`}
      </p>
      <ul className="sc-picks">
        {picks.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onPick(p.id)}>
              <span className="sc-nm">{p.name}</span>
              <span className="sc-num">{p.meta}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function Nothing({ reason }: { reason: string }) {
  return (
    <aside className="sc-card sc-idle sc-empty" aria-label="Nothing to show">
      <h3>Nothing to show here</h3>
      <p className="sc-sum">{reason}</p>
    </aside>
  );
}

const announce = (c: CardData | null) =>
  !c
    ? ""
    : c.kind === "trades"
      ? `${c.name} pinned. ${count(c.rows.length, "member")} traded its stock, ${count(c.trades, "trade")} in all.`
      : c.kind === "pac"
        ? `${c.name} pinned. ${money(c.total)} given before the vote to ${count(c.members, "member")}.`
        : c.kind === "sections"
          ? `${c.name} pinned. ${count(c.count, "section")}.`
          : `${c.name} pinned.`;

export function Scan(props: ScanProps) {
  const phone = useMedia("(max-width: 760px)");
  const { m, focus, setFocus, setMapView } = props;
  const mustRef = useRef(focus ? [focus] : []);
  const scenes = useMemo(() => buildScenes(m, mustRef.current), [m]);
  const empty = useMemo(() => emptiness(scenes), [scenes]);
  const view: MapView = props.mapView in empty ? props.mapView : "trades";

  const fallback = (["trades", "pac", "sections"] as const).find((v) => !empty[v]) ?? null;
  const settled = useRef(false);
  useEffect(() => {
    if (settled.current) return;
    settled.current = true;
    if (empty[view] && fallback && fallback !== view) setMapView(fallback);
  }, [empty, view, fallback, setMapView]);

  useEffect(() => {
    if (focus && !present(scenes, view, focus)) setFocus(null);
  }, [focus, scenes, view, setFocus]);

  const via = useRef<"pointer" | "key">("pointer");
  const pin = useCallback(
    (id: string | null, how: "pointer" | "key" = "pointer") => {
      via.current = how;
      setFocus(id);
    },
    [setFocus],
  );

  const ring = useRef<RingHandle | null>(null);
  const originOf = useCallback((id: string) => ring.current?.originOf(id) ?? null, []);
  const card = useMemo(() => (focus ? cardFor(m, scenes, view, focus) : null), [m, scenes, view, focus]);
  const picks = useMemo(() => picksFor(m, scenes, view), [m, scenes, view]);
  const copy = useMemo(() => copyFor(m, scenes, view), [m, scenes, view]);

  const root = useRef<HTMLElement>(null);
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const revealed = useReveal(root, reduced);

  const titleId = useId();
  const say = announce(focus ? card : null);

  const swipe = useCallback(
    (dir: 1 | -1) => {
      const ids = itemIds(scenes, view);
      if (!ids.length) return;
      const at = focus ? ids.indexOf(focus) : -1;
      pin(ids[at < 0 ? (dir === 1 ? 0 : ids.length - 1) : (at + dir + ids.length) % ids.length]!, "pointer");
    },
    [scenes, view, focus, pin],
  );

  const style = {
    "--sw-ease": SWITCH_EASE.easing,
    "--sw-dur": `${SWITCH_EASE.duration}ms`,
  } as React.CSSProperties;

  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!phone) setOpen(false);
  }, [phone]);

  const idle = empty[view] ? (
    <Nothing reason={empty[view]} />
  ) : (
    <Picks picks={picks} view={view} onPick={(id) => pin(id, "pointer")} />
  );

  if (phone) {
    const none = !fallback;
    const teaserView = empty[view] && fallback ? fallback : view;
    return (
      <section id="map" ref={root} className="scan scan-m" style={style} aria-labelledby={titleId}>
        <div className="sc-teaser">
          <div className="sc-teaser-head">
            <h2 id={titleId}>Who is tied to this bill</h2>
            <span className="sc-eyebrow">The x-ray</span>
          </div>
          <Ring m={m} scenes={scenes} view={teaserView} pinned={null} onPin={pin} revealed={revealed} mini />
          {none ? (
            <p className="sc-teaser-none">
              Nothing to map for this bill: no stock trades tied to its companies, no PAC money before the vote, and no
              CBO figure for any section.
            </p>
          ) : (
            <button type="button" className="sc-open" onClick={() => setOpen(true)} aria-haspopup="dialog">
              Open the x-ray
            </button>
          )}
        </div>
        {open && (
          <Sheet titleId={`${titleId}-sheet`} onClose={() => setOpen(false)} onSwipe={swipe}>
            {(close) => (
              <>
                <div className="sheet-drag">
                  <div className="sc-grab" aria-hidden="true" />
                  <div className="sheet-head">
                    <h2 id={`${titleId}-sheet`}>{copy.title}</h2>
                    <button
                      type="button"
                      className="sheet-close"
                      aria-label="Close the x-ray"
                      onClick={close}
                      data-nodrag
                    >
                      <svg viewBox="0 0 12 12" aria-hidden="true">
                        <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
                      </svg>
                    </button>
                  </div>
                  <ViewSwitch view={view} onChange={setMapView} empty={empty} equal />
                  <div className="sheet-ring">
                    <Ring
                      handle={ring}
                      m={m}
                      scenes={scenes}
                      view={view}
                      pinned={focus}
                      onPin={pin}
                      revealed
                      compact
                      coarse
                      instant={via.current === "key"}
                      empty={empty[view]}
                    />
                  </div>
                </div>
                <div className="sheet-list" aria-live="off">
                  <CardSlot
                    id={focus && card ? focus : null}
                    instant={via.current === "key"}
                    originOf={originOf}
                    render={() =>
                      card && (
                        <CompactCard data={card} more={itemIds(scenes, view).length > 1} onClear={() => pin(null)} />
                      )
                    }
                    idle={
                      empty[view] ? (
                        <Nothing reason={empty[view]} />
                      ) : (
                        <Picks picks={picks} view={view} onPick={(id) => pin(id)} compact />
                      )
                    }
                  />
                </div>
              </>
            )}
          </Sheet>
        )}
        <div className="sc-sr" role="status" aria-live="polite">
          {say}
        </div>
      </section>
    );
  }

  const onAway = (e: React.MouseEvent) => {
    if (focus && !(e.target as HTMLElement).closest("[data-keep]")) pin(null, "pointer");
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc on the ring already clears the pin; this is the pointer shortcut
    // biome-ignore lint/a11y/noStaticElementInteractions: same
    <section
      id="map"
      ref={root}
      className="scan"
      data-view={view}
      style={style}
      aria-labelledby={titleId}
      onClick={onAway}
    >
      <div className="scan-band">
        <div className="scan-inner">
          <div className="scan-copy" data-keep>
            <header className="scan-head">
              <p className="sc-eyebrow">The x-ray</p>
              <h2 id={titleId} key={view}>
                {copy.title}
              </h2>
              <div className="sc-intro" key={`${view}-intro`}>
                <p>{copy.intro}</p>
                {copy.notes.map((n) => (
                  <p key={n} className="sc-note">
                    {n}
                  </p>
                ))}
              </div>
            </header>
            <ViewSwitch view={view} onChange={setMapView} empty={empty} />
            <CardSlot
              id={focus && card ? focus : null}
              instant={via.current === "key"}
              originOf={originOf}
              render={() => card && <Card data={card} onClear={() => pin(null)} />}
              idle={idle}
            />
          </div>
          <div className="scan-ring">
            <Ring
              handle={ring}
              m={m}
              scenes={scenes}
              view={view}
              pinned={focus}
              onPin={pin}
              revealed={revealed}
              instant={via.current === "key"}
              empty={empty[view]}
            />
          </div>
        </div>
      </div>
      <div className="sc-sr" role="status" aria-live="polite">
        {say}
      </div>
    </section>
  );
}
