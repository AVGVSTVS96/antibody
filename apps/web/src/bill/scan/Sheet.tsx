import { createContext, useCallback, useContext, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMedia } from "../../lib/media.ts";
import { nearest, project, rubberBand, SHEET_SPRING, springAt } from "./spring.ts";

interface Props {
  titleId: string;
  onClose: () => void;
  onSwipe: (dir: 1 | -1) => void;
  children: ReactNode;
}

const OVERSHOOT_PAD = 56;
const SLOP = 8;
const height = () => Math.max(360, Math.round(window.innerHeight * 0.82));
const FOCUSABLE = 'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"]),input,select,textarea';

const CloseSheet = createContext<(() => void) | null>(null);

export function SheetClose({ label }: { label: string }) {
  const close = useContext(CloseSheet);

  if (!close) {
    throw new Error("SheetClose renders inside a Sheet");
  }

  return (
    <button type="button" className="sheet-close" aria-label={label} onClick={close} data-nodrag>
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
      </svg>
    </button>
  );
}

function trapTab(e: KeyboardEvent, sheet: HTMLElement) {
  const items = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
  const first = items[0];
  const last = items.at(-1);

  if (!first || !last) {
    return;
  }

  const at = document.activeElement;
  const outside = !sheet.contains(at);

  if (e.shiftKey && (at === first || outside)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (at === last || outside)) {
    e.preventDefault();
    first.focus();
  }
}

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

  const suppress = useRef(false);

  const write = useCallback((y: number) => {
    const s = state.current;
    s.y = y;

    if (sheet.current) {
      sheet.current.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
    }

    if (scrim.current) {
      scrim.current.style.opacity = String(Math.min(1, Math.max(0, 1 - y / s.h)));
    }
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

    if (s.closing) {
      return;
    }

    s.closing = true;
    settle(s.h, 0, onClose);
  }, [settle, onClose]);

  const attach = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) {
        return;
      }

      sheet.current = el;
      const s = state.current;

      const fit = () => {
        s.h = height();
        el.style.height = `${s.h + OVERSHOOT_PAD}px`;
      };

      fit();
      write(s.h);
      const back = document.activeElement;
      settle(0, 0);

      const app = document.querySelector("#root");
      const html = document.documentElement;
      const prev = html.style.overflow;
      html.style.overflow = "hidden";

      if (app instanceof HTMLElement) {
        app.inert = true;
      }

      el.focus({ preventScroll: true });

      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          close();
        } else if (e.key === "Tab") {
          trapTab(e, el);
        }
      };

      const onResize = () => {
        fit();
        write(Math.min(s.y, s.h));
      };

      addEventListener("keydown", onKey);
      addEventListener("resize", onResize);

      return () => {
        cancelAnimationFrame(s.raf);
        removeEventListener("keydown", onKey);
        removeEventListener("resize", onResize);
        html.style.overflow = prev;

        if (app instanceof HTMLElement) {
          app.inert = false;
        }

        if (back instanceof HTMLElement) {
          back.focus({ preventScroll: true });
        }

        sheet.current = null;
      };
    },
    [settle, write, close],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target instanceof Element && e.target.closest("[data-nodrag]") !== null)) {
      return;
    }

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

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;

    if (!d || d.id !== e.pointerId) {
      return;
    }

    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;

    if (!d.lock) {
      if (Math.hypot(dx, dy) < SLOP) {
        return;
      }

      d.lock = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }

    d.samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });

    if (d.samples.length > 8) {
      d.samples.shift();
    }

    if (d.lock === "y") {
      const raw = d.base + dy;
      write(raw < 0 ? -rubberBand(-raw, state.current.h) : raw);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;

    if (!d || d.id !== e.pointerId) {
      return;
    }

    drag.current = null;

    if (!d.lock) {
      return;
    }

    suppress.current = true;
    setTimeout(() => {
      suppress.current = false;
    }, 60);
    const [a] = d.samples;
    const b = d.samples.at(-1);

    if (!a || !b) {
      return;
    }

    const dt = Math.max(b.t - a.t, 1);
    const vy = ((b.y - a.y) / dt) * 1000;
    const vx = ((b.x - a.x) / dt) * 1000;

    if (d.lock === "x") {
      const dx = e.clientX - d.x0;

      if (Math.abs(dx) > 56 || (Math.abs(vx) > 500 && Math.abs(dx) > 24)) {
        onSwipe(dx < 0 ? 1 : -1);
      }

      return;
    }

    const s = state.current;
    const to = nearest(detents(), project(s.y, vy));

    if (to >= s.h) {
      close();
    } else {
      settle(to, vy);
    }
  };

  const swallow = (e: React.MouseEvent) => {
    if (!suppress.current) {
      return;
    }

    e.stopPropagation();
    e.preventDefault();
  };

  return createPortal(
    <div className="sheet-root">
      <div ref={scrim} className="sheet-scrim" onClick={close} aria-hidden="true" />
      <div
        ref={attach}
        className="sheet"
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a hand-dragged sheet with its own spring, focus trap and Escape; <dialog>'s top layer and cancel handling would fight them
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
        <CloseSheet value={close}>{children}</CloseSheet>
      </div>
    </div>,
    document.body,
  );
}
