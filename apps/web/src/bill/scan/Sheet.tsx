import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useMedia } from "../../lib/media.ts";
import { nearest, project, rubberBand, SHEET_SPRING, springAt } from "./spring.ts";

interface Props {
  titleId: string;
  onClose: () => void;
  onSwipe: (dir: 1 | -1) => void;
  children: (close: () => void) => ReactNode;
}

const OVERSHOOT_PAD = 56;
const SLOP = 8;
const height = () => Math.max(360, Math.round(window.innerHeight * 0.82));
const FOCUSABLE = 'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"]),input,select,textarea';

/**
 * A bottom sheet that behaves like a physical one: it follows the finger 1:1, a flick lands on the detent it is heading
 * for (position plus projected momentum), pulling past the top resists, and letting go carries the finger's velocity
 * into a spring. Sideways drags are handed to `onSwipe` instead.
 */
export function Sheet({ titleId, onClose, onSwipe, children }: Props) {
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const sheet = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const state = useRef({ y: 0, v: 0, h: 0, raf: 0, closing: false });
  const drag = useRef<{
    id: number;
    x0: number;
    y0: number;
    base: number;
    lock: "x" | "y" | null;
    samples: { t: number; x: number; y: number }[];
    moved: boolean;
  } | null>(null);
  const opener = useRef<Element | null>(null);
  const suppress = useRef(false);

  const write = useCallback((y: number) => {
    const s = state.current;
    s.y = y;
    if (sheet.current) sheet.current.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
    if (scrim.current) scrim.current.style.opacity = String(Math.min(1, Math.max(0, 1 - y / s.h)));
  }, []);

  const detents = useCallback(() => {
    const h = state.current.h;
    const mid = Math.min(h, Math.max(380, Math.round(h * 0.62)));
    return [0, h - mid, h];
  }, []);

  const settle = useCallback(
    (target: number, v0: number, then?: () => void) => {
      const s = state.current;
      cancelAnimationFrame(s.raf);
      if (reduced) {
        write(target);
        then?.();
        return;
      }
      const from = s.y;
      const t0 = performance.now();
      const step = (now: number) => {
        const t = (now - t0) / 1000;
        const [y, v] = springAt(t, from, v0, target, SHEET_SPRING);
        s.v = v;
        if (t > 1.2 || (Math.abs(y - target) < 0.4 && Math.abs(v) < 8)) {
          write(target);
          s.v = 0;
          then?.();
          return;
        }
        write(y);
        s.raf = requestAnimationFrame(step);
      };
      s.raf = requestAnimationFrame(step);
    },
    [reduced, write],
  );

  const close = useCallback(() => {
    const s = state.current;
    if (s.closing) return;
    s.closing = true;
    settle(s.h, 0, onClose);
  }, [settle, onClose]);

  useLayoutEffect(() => {
    const s = state.current;
    s.h = height();
    if (sheet.current) sheet.current.style.height = `${s.h + OVERSHOOT_PAD}px`;
    write(s.h);
    opener.current = document.activeElement;
    settle(0, 0);
    return () => cancelAnimationFrame(s.raf);
  }, [settle, write]);

  useEffect(() => {
    const app = document.getElementById("root");
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    if (app) app.inert = true;
    sheet.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        close();
      } else if (e.key === "Tab" && sheet.current) {
        const items = [...sheet.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
          (x) => x.offsetParent !== null,
        );
        if (!items.length) return;
        const first = items[0]!;
        const last = items.at(-1)!;
        const at = document.activeElement;
        const outside = !sheet.current.contains(at);
        if (e.shiftKey && (at === first || outside)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (at === last || outside)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    const onResize = () => {
      const s = state.current;
      s.h = height();
      if (sheet.current) sheet.current.style.height = `${s.h + OVERSHOOT_PAD}px`;
      write(Math.min(s.y, s.h));
    };
    addEventListener("keydown", onKey);
    addEventListener("resize", onResize);
    const back = opener.current;
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("resize", onResize);
      html.style.overflow = prev;
      if (app) app.inert = false;
      if (back instanceof HTMLElement) back.focus({ preventScroll: true });
    };
  }, [close, write]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("[data-nodrag]")) return;
    cancelAnimationFrame(state.current.raf);
    drag.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      base: state.current.y,
      lock: null,
      samples: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }],
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.lock) {
      if (Math.hypot(dx, dy) < SLOP) return;
      d.lock = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      d.moved = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    d.samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    if (d.samples.length > 8) d.samples.shift();
    if (d.lock === "y") {
      const raw = d.base + dy;
      write(raw < 0 ? -rubberBand(-raw, state.current.h) : raw);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.lock) return;
    suppress.current = true;
    setTimeout(() => {
      suppress.current = false;
    }, 60);
    const a = d.samples[0]!;
    const b = d.samples.at(-1)!;
    const dt = Math.max(b.t - a.t, 1);
    const vy = ((b.y - a.y) / dt) * 1000;
    const vx = ((b.x - a.x) / dt) * 1000;
    if (d.lock === "x") {
      const dx = e.clientX - d.x0;
      if (Math.abs(dx) > 56 || (Math.abs(vx) > 500 && Math.abs(dx) > 24)) onSwipe(dx < 0 ? 1 : -1);
      return;
    }
    const s = state.current;
    const to = nearest(detents(), project(s.y, vy));
    if (to >= s.h) close();
    else settle(to, vy);
  };

  const swallow = (e: React.MouseEvent) => {
    if (!suppress.current) return;
    e.stopPropagation();
    e.preventDefault();
  };

  return createPortal(
    <div className="sheet-root">
      <div ref={scrim} className="sheet-scrim" onClick={close} aria-hidden="true" />
      <div
        ref={sheet}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={swallow}
      >
        {children(close)}
      </div>
    </div>,
    document.body,
  );
}
