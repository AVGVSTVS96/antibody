import type { Claim } from "@antibody/core";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { sourceName } from "../lib/format.ts";

interface Open {
  id: string;
  rect: DOMRect;
}

interface Ctx {
  loading: boolean;
  claim: (id: string) => Claim | undefined;
  open: (id: string, el: HTMLElement) => void;
  close: (now?: boolean) => void;
  keep: () => void;
}

const ClaimCtx = createContext<Ctx | null>(null);

export function useClaims(): Ctx {
  const ctx = useContext(ClaimCtx);

  if (!ctx) {
    throw new Error("source chips render inside a ClaimProvider");
  }

  return ctx;
}

const OPEN_DELAY = 220;
const CLOSE_GRACE = 160;

export function ClaimProvider({ claims, children }: { claims: Record<string, Claim> | null; children: ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const shown = useRef(false);

  const ctx = useMemo<Ctx>(() => {
    const show = (next: Open | null) => {
      shown.current = next !== null;
      setOpen(next);
    };

    return {
      loading: claims === null,
      claim: (id) => claims?.[id],
      open(id, el) {
        clearTimeout(timer.current);

        const go = () => {
          show({ id, rect: el.getBoundingClientRect() });
        };

        if (shown.current) {
          go();
        } else {
          timer.current = setTimeout(go, OPEN_DELAY);
        }
      },
      close(now = false) {
        clearTimeout(timer.current);

        if (now) {
          show(null);
        } else {
          timer.current = setTimeout(() => {
            show(null);
          }, CLOSE_GRACE);
        }
      },
      keep: () => {
        clearTimeout(timer.current);
      },
    };
  }, [claims]);

  const claim = open === null ? undefined : claims?.[open.id];

  return (
    <ClaimCtx.Provider value={ctx}>
      {children}
      {open && claims && claim && <ClaimPopover claim={claim} rect={open.rect} all={claims} />}
    </ClaimCtx.Provider>
  );
}

interface Placed {
  left: number;
  top: number;
  origin: string;
}

function ClaimPopover({ claim: c, rect, all }: { claim: Claim; rect: DOMRect; all: Record<string, Claim> }) {
  const { keep, close } = useClaims();
  const [pos, setPos] = useState<Placed | null>(null);

  const place = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) {
        return;
      }

      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const below = rect.bottom + 6 + h < innerHeight - 8;
      setPos({
        left: Math.min(Math.max(12, rect.left), innerWidth - w - 12),
        top: below ? rect.bottom + 6 : Math.max(8, rect.top - h - 6),
        origin: below ? "top left" : "bottom left",
      });

      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          close(true);
        }
      };

      const onScroll = () => {
        close(true);
      };

      addEventListener("keydown", onKey);
      addEventListener("scroll", onScroll, { capture: true, passive: true });

      return () => {
        removeEventListener("keydown", onKey);
        removeEventListener("scroll", onScroll, { capture: true });
      };
    },
    [rect, close],
  );

  const style: CSSProperties & { "--origin"?: string } = pos
    ? { left: pos.left, top: pos.top, "--origin": pos.origin }
    : { left: -9999, top: 0 };

  const rests = c.restsOn.map((id) => all[id]).filter((x): x is Claim => !!x);

  return createPortal(
    <div
      ref={place}
      className="claimpop"
      role="tooltip"
      style={style}
      onPointerEnter={keep}
      onPointerLeave={() => {
        close();
      }}
    >
      <div className="head">
        <KindPill kind={c.kind} />
        <span className="cap">{sourceName(c.sourceUrl)}</span>
        {c.confidence < 1 && <span className="cap dim">confidence {Math.round(c.confidence * 100)}%</span>}
      </div>
      <div className="text">{c.text}</div>
      {c.quote !== null && c.quote !== "" && (
        <div className="quote">“{c.quote.length > 320 ? `${c.quote.slice(0, 320)}…` : c.quote}”</div>
      )}
      {(c.sourceLocator ?? "") !== "" && (
        <div className="ln">
          Where: <b>{c.sourceLocator}</b>
        </div>
      )}
      {(c.rule ?? "") !== "" && (
        <div className="ln">
          Rule: <b>{c.rule}</b>
        </div>
      )}
      {rests.length > 0 && (
        <>
          <div className="ln">Rests on:</div>
          <div className="rests">
            {rests.slice(0, 5).map((r) => (
              <a key={r.id} href={r.sourceUrl} target="_blank" rel="noopener">
                {r.kind === "inference" ? "◇ " : ""}
                {r.text}
              </a>
            ))}
            {rests.length > 5 && <span className="dim">and {rests.length - 5} more</span>}
          </div>
        </>
      )}
      <div className="chips">
        <a className="src" href={c.sourceUrl} target="_blank" rel="noopener">
          open {sourceName(c.sourceUrl)}
        </a>
        {c.archiveUrl !== null && (
          <a className="src" href={c.archiveUrl} target="_blank" rel="noopener">
            archived copy
          </a>
        )}
      </div>
    </div>,
    document.body,
  );
}

export const KindPill = ({ kind }: { kind: Claim["kind"] }) =>
  kind === "inference" ? <span className="pill inf">inference</span> : <span className="pill fact">fact</span>;

export const Inf = () => <span className="pill inf">inference</span>;

export function Src({ id, label }: { id: string; label?: string }) {
  const { claim, open, close, loading } = useClaims();
  const c = claim(id);

  const onEnter = useCallback(
    (e: React.SyntheticEvent<HTMLAnchorElement>) => {
      open(id, e.currentTarget);
    },
    [id, open],
  );

  if (!c) {
    return loading ? (
      <span className="src ghost" aria-hidden="true">
        {label ?? "source"}
      </span>
    ) : null;
  }

  return (
    <a
      className={`src${c.kind === "inference" ? " inference" : ""}`}
      href={c.sourceUrl}
      target="_blank"
      rel="noopener"
      onPointerEnter={onEnter}
      onPointerLeave={() => {
        close();
      }}
      onFocus={onEnter}
      onBlur={() => {
        close(true);
      }}
      aria-label={`${c.kind}: ${c.text} Source: ${sourceName(c.sourceUrl)}`}
    >
      {label ?? sourceName(c.sourceUrl)}
    </a>
  );
}

export function Sources({ ids, max = 3 }: { ids: (string | null | undefined)[]; max?: number }) {
  const { claim, loading } = useClaims();

  if (loading) {
    return ids.some(Boolean) ? (
      <span className="chips">
        <span className="src ghost" aria-hidden="true">
          source
        </span>
      </span>
    ) : null;
  }

  const seen = new Set<string>();
  const unique: string[] = [];

  for (const id of ids) {
    const c = id === null || id === undefined || id === "" ? undefined : claim(id);

    if (!c) {
      continue;
    }

    const key = `${c.kind}|${c.sourceUrl}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(c.id);
  }

  if (!unique.length) {
    return null;
  }

  return (
    <span className="chips">
      {unique.slice(0, max).map((id) => (
        <Src key={id} id={id} />
      ))}
      {unique.length > max && <span className="cap dim">+{unique.length - max}</span>}
    </span>
  );
}

export function ClaimLink({
  id,
  className,
  children,
}: {
  id: string | null | undefined;
  className?: string;
  children: ReactNode;
}) {
  const { claim, open, close } = useClaims();
  const c = id === null || id === undefined || id === "" ? undefined : claim(id);

  if (!c || id === null || id === undefined) {
    return <span className={className}>{children}</span>;
  }

  const onEnter = (e: React.SyntheticEvent<HTMLAnchorElement>) => {
    open(id, e.currentTarget);
  };

  return (
    <a
      className={className}
      href={c.sourceUrl}
      target="_blank"
      rel="noopener"
      onPointerEnter={onEnter}
      onPointerLeave={() => {
        close();
      }}
      onFocus={onEnter}
      onBlur={() => {
        close(true);
      }}
    >
      {children}
    </a>
  );
}
