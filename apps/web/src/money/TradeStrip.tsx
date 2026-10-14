import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { day } from "../lib/format.ts";
import { memberHref, onLink } from "../lib/router.ts";
import { ownerWords, type Trade, tradeVerb } from "../lib/trades.ts";
import { useModel } from "../ui/BillGate.tsx";
import { Src } from "../ui/receipt.tsx";
import { chipName } from "./Members.tsx";
import { usePhone } from "./usePhone.ts";
import "./money.css";

type Dir = "up" | "down" | "flat";

/** Trades of one kind on one day: a stack, taller the more there are. */
interface Stack {
  date: string;
  dir: Dir;
  trades: Trade[];
  /** 0..1 along the strip. */
  at: number;
}

/** A tick the card is open for: where it sits in px along the strip, and the strip's own box at that moment. */
interface Open {
  stack: Stack;
  x: number;
  strip: DOMRect;
}

const HIT = 7;
const MAX_SHOWN = 3;

const dirOf = (t: Trade): Dir => (t.event.type === "purchase" ? "up" : t.event.type === "exchange" ? "flat" : "down");
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

export interface TradeStripProps {
  trades: readonly Trade[];
  /** The dates at the strip's left and right edges. */
  domain: readonly [string, string];
  window: readonly [string, string] | null;
  label: string;
  /** Ticks outside the window draw gray, so the ones inside stand out. */
  fade?: boolean;
  /** `row`: thin ticks in a ledger row. `chart`: the 4px blocks of a member's own chart. */
  size?: "row" | "chart";
  /** Drawn behind the ticks: the window band is the strip's own unless the chart draws one across every row. */
  band?: boolean;
}

function stacksOf(trades: readonly Trade[], domain: readonly [string, string]): Stack[] {
  const [from, to] = [ms(domain[0]), ms(domain[1])];
  const by = new Map<string, Stack>();
  for (const t of trades) {
    const dir = dirOf(t);
    const key = `${t.event.date}|${dir}`;
    const s = by.get(key) ?? {
      date: t.event.date,
      dir,
      trades: [],
      at: (ms(t.event.date) - from) / Math.max(1, to - from),
    };
    s.trades.push(t);
    by.set(key, s);
  }
  return [...by.values()].sort((a, b) => a.at - b.at);
}

const GEOM = {
  row: { h: 44, w: 1, base: 5, step: 3, max: 19 },
  chart: { h: 30, w: 4, base: 5, step: 2, max: 13 },
} as const;

function height(n: number, size: "row" | "chart") {
  const g = GEOM[size];
  return Math.min(g.max, g.base + g.step * (n - 1));
}

function Entry({ trade, solo }: { trade: Trade; solo: boolean }) {
  const m = useModel();
  const member = m.memberById.get(trade.member)!.node;
  const { event } = trade;
  return (
    <div className="tcard-entry">
      <p className="tcard-kicker">
        {event.ticker ?? "—"} · {tradeVerb(event.type)} · {day(event.date)}
      </p>
      <p className="tcard-who">
        <a className="plain" href={memberHref(m.b.bill.id, member.props.bioguide)} onClick={onLink}>
          {member.label}
        </a>
      </p>
      <p className="tcard-amount">
        {event.amount.replace(/\s*-\s*/, "–")} · {ownerWords(event.owner)}
      </p>
      {solo && <p className="tcard-tie">A tie is not proof.</p>}
      <p className="tcard-links">
        <Src ids={event.claim} context={`${chipName(member)} ${tradeVerb(event.type)} ${event.ticker ?? "a stock"}`} />
        <a href={memberHref(m.b.bill.id, member.props.bioguide)} onClick={onLink}>
          Open member
        </a>
      </p>
    </div>
  );
}

function Card({ open: { stack, x, strip }, pinned, onClose }: { open: Open; pinned: boolean; onClose: () => void }) {
  const shown = stack.trades.slice(0, MAX_SHOWN);
  const phone = usePhone();
  const half = 150;
  const left = Math.max(12 - strip.left, Math.min(x - half, innerWidth - 12 - strip.left - half * 2));
  return (
    <div
      className="tcard"
      data-pinned={pinned || undefined}
      style={phone ? undefined : { left }}
      role={pinned ? "dialog" : undefined}
      aria-live="polite"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {pinned && (
        <button type="button" className="tcard-x" onClick={onClose} aria-label="Close">
          ×
        </button>
      )}
      {shown.map((t) => (
        <Entry key={`${t.edge.id}${t.event.claim}`} trade={t} solo={stack.trades.length === 1} />
      ))}
      {stack.trades.length > MAX_SHOWN && (
        <p className="tcard-more">
          + {stack.trades.length - MAX_SHOWN} more {stack.dir === "up" ? "buys" : "sales"} that day. A tie is not proof.
        </p>
      )}
      {stack.trades.length > 1 && stack.trades.length <= MAX_SHOWN && <p className="tcard-tie">A tie is not proof.</p>}
    </div>
  );
}

/**
 * One row of ticks along a date axis: a buy stands above the line, a sale hangs below it, an exchange crosses it.
 * Hover widens a tick and opens its card; a click or tap pins the card, with the filing link.
 */
export function TradeStrip({ trades, domain, window, label, fade, size = "row", band = true }: TradeStripProps) {
  const g = GEOM[size];
  const stacks = useMemo(() => stacksOf(trades, domain), [trades, domain]);
  const [hover, setHover] = useState<Open | null>(null);
  const [pinned, setPinned] = useState<Open | null>(null);
  const [key, setKey] = useState(0);
  const box = useRef<HTMLFieldSetElement>(null);
  const mid = g.h / 2;
  const shown = pinned ?? hover;
  const span = Math.max(1, ms(domain[1]) - ms(domain[0]));
  const band_ = window
    ? ([(ms(window[0]) - ms(domain[0])) / span, (ms(window[1]) - ms(domain[0]) + 86_400_000) / span] as const)
    : null;

  const place = (stack: Stack): Open => {
    const strip = box.current!.getBoundingClientRect();
    return { stack, x: stack.at * strip.width, strip };
  };

  const nearest = (clientX: number, reach: number) => {
    const px = clientX - box.current!.getBoundingClientRect().left;
    let best: Open | null = null;
    let gap = reach;
    for (const s of stacks) {
      const open = place(s);
      if (Math.abs(open.x - px) <= gap) {
        gap = Math.abs(open.x - px);
        best = open;
      }
    }
    return best;
  };

  useEffect(() => {
    if (!pinned) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setPinned(null);
    };
    addEventListener("keydown", close);
    addEventListener("pointerdown", close);
    return () => {
      removeEventListener("keydown", close);
      removeEventListener("pointerdown", close);
    };
  }, [pinned]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (!stacks.length) return;
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step) {
      e.preventDefault();
      const next = Math.min(stacks.length - 1, Math.max(0, key + step));
      setKey(next);
      setHover(place(stacks[next]!));
    } else if ((e.key === "Enter" || e.key === " ") && hover) {
      e.preventDefault();
      setPinned(hover);
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && !pinned) setHover(nearest(e.clientX, HIT));
  };

  const onPointerDown = (e: PointerEvent) => {
    const hit = nearest(e.clientX, e.pointerType === "mouse" ? HIT : 18);
    if (hit) {
      e.stopPropagation();
      setPinned(hit);
    }
  };

  const total = trades.length;
  return (
    <fieldset
      ref={box}
      className="strip"
      data-size={size}
      style={{ height: g.h }}
      aria-label={`${label}: ${total} trades. Left and right arrows step through them, Enter opens one.`}
      tabIndex={stacks.length ? 0 : -1}
      onKeyDown={onKeyDown}
      onBlur={() => setHover(null)}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHover(null)}
      onPointerDown={onPointerDown}
    >
      <svg className="strip-svg" width="100%" height={g.h} aria-hidden="true">
        {band && band_ && (
          <rect
            className="strip-band"
            x={`${band_[0] * 100}%`}
            width={`${Math.max(0.6, (band_[1] - band_[0]) * 100)}%`}
            height={g.h}
          />
        )}
        <line className="strip-base" x1="0" x2="100%" y1={mid} y2={mid} />
        {stacks.map((s) => {
          const h = s.dir === "flat" ? 3 : height(s.trades.length, size);
          const inside = !fade || s.trades[0]!.inWindow;
          const on = shown?.stack === s;
          const w = on ? 4 : inside && fade ? 2 : g.w;
          return (
            <rect
              key={`${s.date}${s.dir}`}
              className="strip-tick"
              data-out={inside ? undefined : ""}
              data-on={on || undefined}
              x={`${s.at * 100}%`}
              y={s.dir === "down" ? mid : mid - h}
              width={w}
              height={s.dir === "flat" ? h * 2 : h}
              style={{ transform: `translateX(${-w / 2}px)` }}
            />
          );
        })}
      </svg>
      {shown && <Card open={shown} pinned={!!pinned} onClose={() => setPinned(null)} />}
    </fieldset>
  );
}
