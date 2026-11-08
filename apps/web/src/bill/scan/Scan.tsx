import { useCallback, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { count } from "../../lib/format.ts";
import { useSeenOnce, useWindowEvent } from "../../lib/hooks.ts";
import { useMedia } from "../../lib/media.ts";
import type { BillModel } from "../../lib/model.ts";
import { Card, CompactCard } from "./Card.tsx";
import { coName, groupCard, memberCard, money, pacCard, tradesCard } from "./cards.ts";
import type { CardData } from "./cards.ts";
import { buildScenes, emptiness, itemIds, present } from "./layout.ts";
import type { MapView, Scenes } from "./layout.ts";
import { Ring } from "./Ring.tsx";
import type { RingHandle } from "./Ring.tsx";
import { Sheet, SheetClose } from "./Sheet.tsx";
import { CARD_SPRING, springEasing } from "./spring.ts";
import { Switch } from "./Switch.tsx";
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

  if (view === "sections") {
    return null;
  }

  if (id.startsWith("member:")) {
    const v = m.memberById.get(id);
    const ties = s.ring[view].data.byMember.get(id);

    return v && ties ? memberCard(m, v, view, ties) : null;
  }

  const a = m.actorById.get(id);

  if (!a) {
    return null;
  }

  const ties = s.allTies[view].get(id) ?? [];

  return view === "trades" ? tradesCard(m, a, ties) : pacCard(m, a, ties);
}

interface Pick {
  id: string;
  name: string;
  meta: string;
}

function picksFor(m: BillModel, s: Scenes, view: MapView): Pick[] {
  if (view === "sections") {
    return s.groups
      .map((g) => groupCard(g))
      .toSorted((a, b) => Math.abs(b.netMusd) - Math.abs(a.netMusd))
      .slice(0, 5)
      .map((c) => ({ id: c.id, name: c.name, meta: count(c.count, "section") }));
  }

  const { data } = s.ring[view];

  return data.companies.slice(0, 5).map((a) => {
    const n = data.byCompany.get(a.id) ?? [];

    return {
      id: a.id,
      name: coName(a),
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

    if (s.sections.some((x) => x.estimate)) {
      notes.push("Dashed bars split a group figure evenly across its sections, which is an inference.");
    }

    return {
      title: TITLES.sections,
      intro:
        "Each bar is one section, grouped by the title of the bill it sits in. The longer the bar, the more CBO says it costs; each ring is ten times the last. Faded bars save money. Short stubs have no CBO figure.",
      notes,
    };
  }

  const { data } = s.ring[view];
  const cut = data.candidates.companies > data.companies.length;

  if (view === "pac") {
    return {
      title: TITLES.pac,
      intro:
        "Same ring, different tie. The middle ring is the companies whose political action committees gave to members of Congress before they voted on the bill, sized by how much. The outer ring is every member who got some. Pick a company to see who it gave to.",
      notes: [
        "Each PAC is matched to its company by a published rule, so these ties are inferences and drawn dashed.",
        ...(cut
          ? [
              `Showing the ${data.companies.length} of the ${data.candidates.companies} tied companies whose PACs gave, most money first.`,
            ]
          : []),
      ],
    };
  }

  return {
    title: TITLES.trades,
    intro: `The bill sits in the middle, ringed by its ${count(n, "section")}. Around them are the companies that lobbied on it, and on the outside the members of Congress who traded those companies’ stock. Pick any company to light up its ties.`,
    notes: cut
      ? [
          `Showing the ${data.companies.length} of the ${data.candidates.companies} tied companies a member traded, most traders first.`,
        ]
      : [],
  };
}

interface SlotProps {
  id: string | null;
  instant: boolean;
  originOf: (id: string) => { x: number; y: number } | null;
  render: (id: string) => ReactNode;
  idle: ReactNode;
}

interface Shown {
  id: string;
  node: ReactNode;
}

function CardSlot({ id, instant, originOf, render, idle }: SlotProps) {
  const node = id === null ? null : render(id);
  const live = id !== null && node !== null && node !== false ? { id, node } : null;
  const [shown, setShown] = useState<Shown | null>(live);
  const [leaving, setLeaving] = useState<Shown[]>([]);

  if (shown?.id !== live?.id) {
    if (shown) {
      setLeaving((l) => [...l, shown]);
    }

    setShown(live);
  }

  return (
    <div className="sc-slot" data-keep>
      {leaving.map((l) => (
        <div
          key={`out-${l.id}`}
          className="sc-card-wrap sc-leaving"
          aria-hidden="true"
          inert
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget) {
              setLeaving((all) => all.filter((x) => x !== l));
            }
          }}
        >
          {l.node}
        </div>
      ))}
      {live ? (
        <Enter key={live.id} id={live.id} instant={instant} originOf={originOf}>
          {live.node}
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
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el || instant) {
        return;
      }

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
    },
    [id, instant, originOf],
  );

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
  compact = false,
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
            <button
              type="button"
              onClick={() => {
                onPick(p.id);
              }}
            >
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

const reason = (why: string | null) => (why === "" ? null : why);

const announce = (c: CardData | null) =>
  c
    ? c.kind === "trades"
      ? `${c.name} pinned. ${count(c.rows.length, "member")} traded its stock, ${count(c.trades, "trade")} in all.`
      : c.kind === "pac"
        ? `${c.name} pinned. ${money(c.total)} given before the vote to ${count(c.members, "member")}.`
        : c.kind === "sections"
          ? `${c.name} pinned. ${count(c.count, "section")}.`
          : `${c.name} pinned.`
    : "";

export function Scan(props: ScanProps) {
  const phone = useMedia("(max-width: 760px)");
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const { m, setFocus, setMapView } = props;
  // oxlint-disable-next-line react/hook-use-state -- the focus a deep link arrived with stays in the layout for the map's life, so later pins don't rebuild it
  const [must] = useState(() => (props.focus === null ? [] : [props.focus]));
  const scenes = useMemo(() => buildScenes(m, must), [m, must]);

  const empty = useMemo(() => {
    const e = emptiness(scenes);

    return { trades: reason(e.trades), pac: reason(e.pac), sections: reason(e.sections) };
  }, [scenes]);

  const fallback = (["trades", "pac", "sections"] as const).find((v) => empty[v] === null) ?? null;
  const [picked, setPicked] = useState(false);

  const requested: MapView = props.mapView in empty ? props.mapView : "trades";
  const view = !picked && empty[requested] !== null && fallback !== null ? fallback : requested;
  const focus = props.focus !== null && present(scenes, view, props.focus) ? props.focus : null;
  const [via, setVia] = useState<"pointer" | "key">("pointer");
  const instant = via === "key";

  const pickView = useCallback(
    (v: MapView) => {
      setPicked(true);
      setMapView(v);
    },
    [setMapView],
  );

  const pin = useCallback(
    (id: string | null, how: "pointer" | "key" = "pointer") => {
      setVia(how);
      setFocus(id);
    },
    [setFocus],
  );

  useWindowEvent(
    "keydown",
    useCallback(
      (e: KeyboardEvent) => {
        if (focus !== null && !phone && e.key === "Escape" && !e.defaultPrevented) {
          pin(null, "key");
        }
      },
      [focus, phone, pin],
    ),
  );

  const ring = useRef<RingHandle | null>(null);
  const originOf = useCallback((id: string) => ring.current?.originOf(id) ?? null, []);
  const card = useMemo(() => (focus === null ? null : cardFor(m, scenes, view, focus)), [m, scenes, view, focus]);
  const picks = useMemo(() => picksFor(m, scenes, view), [m, scenes, view]);
  const copy = useMemo(() => copyFor(m, scenes, view), [m, scenes, view]);
  const [revealRef, seen] = useSeenOnce(0.3);
  const revealed = seen || reduced;

  const titleId = useId();
  const say = announce(card);

  const swipe = useCallback(
    (dir: 1 | -1) => {
      const ids = itemIds(scenes, view);
      const at = focus === null ? -1 : ids.indexOf(focus);
      const next = ids[at < 0 ? (dir === 1 ? 0 : ids.length - 1) : (at + dir + ids.length) % ids.length];

      if (next !== undefined) {
        pin(next, "pointer");
      }
    },
    [scenes, view, focus, pin],
  );

  const style: CSSProperties & Record<"--sw-ease" | "--sw-dur", string> = {
    "--sw-ease": SWITCH_EASE.easing,
    "--sw-dur": `${SWITCH_EASE.duration}ms`,
  };

  const [open, setOpen] = useState(false);

  if (open && !phone) {
    setOpen(false);
  }

  const closeSheet = useCallback(() => {
    setOpen(false);
  }, []);

  const idle =
    empty[view] === null ? (
      <Picks
        picks={picks}
        view={view}
        onPick={(id) => {
          pin(id, "pointer");
        }}
      />
    ) : (
      <Nothing reason={empty[view]} />
    );

  if (phone) {
    const none = !fallback;
    const teaserView = empty[view] !== null && fallback !== null ? fallback : view;

    return (
      <section id="map" ref={revealRef} className="scan scan-m" style={style} aria-labelledby={titleId}>
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
            <button
              type="button"
              className="sc-open"
              onClick={() => {
                setOpen(true);
              }}
              aria-haspopup="dialog"
            >
              Open the x-ray
            </button>
          )}
        </div>
        {open && (
          <Sheet titleId={`${titleId}-sheet`} onClose={closeSheet} onSwipe={swipe}>
            <>
              <div className="sheet-drag">
                <div className="sc-grab" aria-hidden="true" />
                <div className="sheet-head">
                  <h2 id={`${titleId}-sheet`}>{copy.title}</h2>
                  <SheetClose label="Close the x-ray" />
                </div>
                <Switch view={view} onChange={pickView} empty={empty} equal />
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
                    instant={instant}
                    empty={empty[view]}
                  />
                </div>
              </div>
              <div className="sheet-list" aria-live="off">
                <CardSlot
                  id={focus !== null && card !== null ? focus : null}
                  instant={instant}
                  originOf={originOf}
                  render={() =>
                    card && (
                      <CompactCard
                        data={card}
                        more={itemIds(scenes, view).length > 1}
                        onClear={() => {
                          pin(null);
                        }}
                      />
                    )
                  }
                  idle={
                    empty[view] === null ? (
                      <Picks
                        picks={picks}
                        view={view}
                        onPick={(id) => {
                          pin(id);
                        }}
                        compact
                      />
                    ) : (
                      <Nothing reason={empty[view]} />
                    )
                  }
                />
              </div>
            </>
          </Sheet>
        )}
        <output className="sc-sr" aria-live="polite">
          {say}
        </output>
      </section>
    );
  }

  const onAway = (e: React.MouseEvent) => {
    const kept = e.target instanceof Element && e.target.closest("[data-keep]") !== null;

    if (focus !== null && !kept) {
      pin(null, "pointer");
    }
  };

  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- clicking the band's background is the pointer shortcut for Esc, which already clears the pin
    <section
      id="map"
      ref={revealRef}
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
            <Switch view={view} onChange={pickView} empty={empty} />
            <CardSlot
              id={focus !== null && card !== null ? focus : null}
              instant={instant}
              originOf={originOf}
              render={() =>
                card && (
                  <Card
                    data={card}
                    onClear={() => {
                      pin(null);
                    }}
                  />
                )
              }
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
              instant={instant}
              empty={empty[view]}
            />
          </div>
        </div>
      </div>
      <output className="sc-sr" aria-live="polite">
        {say}
      </output>
    </section>
  );
}
