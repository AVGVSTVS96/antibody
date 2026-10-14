import type { Bundle, Claim } from "@antibody/core";
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { sourceName } from "../lib/format.ts";
import { useMedia } from "../lib/media.ts";
import { citation, notShown, provenance, ruleId, ruleUrl } from "../lib/receipt-copy.ts";
import { InferenceTag, Tag } from "./primitives.tsx";

interface Props {
  lookup: (id: string) => Claim | null | undefined;
  request: (ids: readonly string[]) => void;
  rules: Bundle["rules"];
  walk: { ids: readonly string[]; at: number };
  label?: string;
  nested: boolean;
  closing: boolean;
  onClose: () => void;
  onBack: () => void;
  onStep: (delta: number) => void;
  onRest: (index: number) => void;
}

const FOCUSABLE = "a[href],button:not([disabled]),[tabindex]:not([tabindex='-1'])";
const REST_PAGE = 8;
const SWIPE = { dx: 64, drag: 110 };

const place = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.host.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}${u.search}`;
  } catch {
    return url;
  }
};

export function ReceiptDrawer({
  lookup,
  request,
  rules,
  walk,
  label,
  nested,
  closing,
  onClose,
  onBack,
  onStep,
  onRest,
}: Props) {
  const panel = useRef<HTMLElement>(null);
  const phone = useMedia("(max-width: 720px)");
  const id = walk.ids[walk.at]!;
  const claim = lookup(id);
  const count = walk.ids.length;

  useEffect(() => {
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus({ preventScroll: true });
  });
  useEffect(() => request(walk.ids.slice(Math.max(walk.at - 1, 0), walk.at + 2)), [request, walk.ids, walk.at]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      onStep(e.key === "ArrowLeft" ? -1 : 1);
    } else if (e.key === "Tab") {
      const items = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      const here = document.activeElement;
      if (e.shiftKey && (here === first || here === panel.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && here === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const drag = useRef<{ y: number; dy: number } | null>(null);
  const grab = {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (!phone || (e.target as HTMLElement).closest("button,a")) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { y: e.clientY, dy: 0 };
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const d = drag.current;
      if (!d || !panel.current) return;
      d.dy = Math.max(0, e.clientY - d.y);
      panel.current.style.transition = "none";
      panel.current.style.transform = `translateY(${d.dy}px)`;
    },
    onPointerUp() {
      const d = drag.current;
      const el = panel.current;
      drag.current = null;
      if (!d || !el) return;
      el.style.transition = "transform 200ms cubic-bezier(.3,0,.8,.15)";
      if (d.dy > SWIPE.drag) {
        el.style.animation = "none";
        el.style.transform = "translateY(100%)";
        onClose();
      } else el.style.transform = "";
    },
  };

  const swipe = useRef<{ x: number; y: number } | null>(null);
  const body = {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      swipe.current = e.pointerType === "touch" ? { x: e.clientX, y: e.clientY } : null;
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      const s = swipe.current;
      swipe.current = null;
      if (!s) return;
      const dx = e.clientX - s.x;
      if (Math.abs(dx) > SWIPE.dx && Math.abs(dx) > 2 * Math.abs(e.clientY - s.y)) onStep(dx < 0 ? 1 : -1);
    },
  };

  return (
    <>
      <div className="rcpt-scrim" data-closing={closing || undefined} onClick={onClose} aria-hidden="true" />
      <aside
        ref={panel}
        className="rcpt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rcpt-claim"
        tabIndex={-1}
        data-closing={closing || undefined}
        onKeyDown={onKey}
      >
        <div className="rcpt-grab" {...grab}>
          <i />
        </div>
        <header className="rcpt-head" {...grab}>
          {nested ? (
            <button type="button" className="rcpt-back" onClick={onBack}>
              ← BACK
            </button>
          ) : (
            <span className="rcpt-title">RECEIPT · ONE MARK, ONE RECORD</span>
          )}
          <span className="rcpt-esc" aria-hidden="true">
            ESC
          </span>
          <button type="button" className="box-btn" aria-label="Close the receipt" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="rcpt-scroll" key={id} {...body}>
          {claim ? (
            <Record claim={claim} lookup={lookup} request={request} rules={rules} label={label} onRest={onRest} />
          ) : (
            <div className="rcpt-pad">
              <h2 id="rcpt-claim" className="rcpt-claim">
                {claim === null ? "This record could not be loaded." : "Loading the record…"}
              </h2>
              {claim === null && <p className="rcpt-prov">CLAIM ID · {id}</p>}
            </div>
          )}
        </div>
        <footer className="rcpt-foot">
          {claim && (
            <div className="rcpt-actions">
              <a className="btn go" href={claim.sourceUrl} target="_blank" rel="noopener noreferrer">
                OPEN {sourceName(claim.sourceUrl).toUpperCase()} ↗
              </a>
              <Copy text={citation(claim)} />
            </div>
          )}
          {count > 1 && (
            <div className="rcpt-nav">
              <button
                type="button"
                className="box-btn"
                aria-label="Previous"
                disabled={walk.at === 0}
                onClick={() => onStep(-1)}
              >
                ←
              </button>
              <button
                type="button"
                className="box-btn"
                aria-label="Next"
                disabled={walk.at === count - 1}
                onClick={() => onStep(1)}
              >
                →
              </button>
              <span aria-live="polite">
                {nested ? "RECORD" : "MARK"} {walk.at + 1} OF {count}
              </span>
            </div>
          )}
        </footer>
      </aside>
    </>
  );
}

function Record({
  claim: c,
  lookup,
  request,
  rules,
  label,
  onRest,
}: {
  claim: Claim;
  lookup: Props["lookup"];
  request: Props["request"];
  rules: Bundle["rules"];
  label?: string;
  onRest: (index: number) => void;
}) {
  const inference = c.kind === "inference";
  const rid = ruleId(c);
  const rule = rules.find((r) => r.id === rid);
  return (
    <>
      <div className="rcpt-pad rcpt-top">
        {label && <p className="rcpt-label">{label}</p>}
        <div className="rcpt-tags">
          {inference ? <InferenceTag /> : <Tag tone="ink">FACT</Tag>}
          <span className="rcpt-prov">{provenance(c)}</span>
        </div>
        <h2 id="rcpt-claim" className="rcpt-claim" data-long={c.text.length > 150 || undefined} aria-live="polite">
          {c.text}
        </h2>
      </div>
      {c.quote && (
        <blockquote className="rcpt-quote">
          <span className="kicker">THE RECORD'S OWN WORDS</span>
          <p>{c.quote}</p>
        </blockquote>
      )}
      <dl className="rcpt-rows">
        <dt>SOURCE</dt>
        <dd>
          <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer">
            {place(c.sourceUrl)} ↗
          </a>
        </dd>
        {c.sourceLocator && (
          <>
            <dt>WHERE</dt>
            <dd>{c.sourceLocator}</dd>
          </>
        )}
        {c.archiveUrl && (
          <>
            <dt>ARCHIVED</dt>
            <dd>
              <a href={c.archiveUrl} target="_blank" rel="noopener noreferrer">
                {place(c.archiveUrl)} ↗
              </a>
            </dd>
          </>
        )}
        <dt>RESTS ON</dt>
        <dd>
          {c.restsOn.length
            ? `${c.restsOn.length.toLocaleString("en-US")} ${c.restsOn.length === 1 ? "record" : "records"}, listed below.`
            : "Nothing else. This is the primary record, not a derived number."}
        </dd>
      </dl>
      {inference && (
        <Rule
          id={rid}
          text={rule?.text ?? c.rule?.slice((rid?.length ?? 0) + 1).trim()}
          url={rule?.url ?? (rid ? ruleUrl(rid) : null)}
        />
      )}
      {c.restsOn.length > 0 && <RestsOn key={c.id} claim={c} lookup={lookup} request={request} onRest={onRest} />}
      <div className="rcpt-pad rcpt-end">
        <div className="rcpt-not">
          <b>WHAT THIS DOES NOT SHOW</b>
          <p>{notShown(c)}</p>
        </div>
      </div>
    </>
  );
}

function Rule({ id, text, url }: { id: string | null; text?: string; url: string | null }) {
  const [more, setMore] = useState(false);
  const long = (text?.length ?? 0) > 260;
  return (
    <section className="rcpt-rule">
      <span className="kicker">RULE · {id?.toUpperCase() ?? "NAMED IN THE CLAIM"} · SAME FOR EVERY BILL</span>
      {text && <p className={long && !more ? "clamp" : undefined}>{text}</p>}
      <div className="rcpt-rule-links">
        {long && (
          <button type="button" className="linkbtn" aria-expanded={more} onClick={() => setMore(!more)}>
            {more ? "Show less" : "Show the whole rule"}
          </button>
        )}
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer">
            Read the full rule ↗
          </a>
        )}
      </div>
    </section>
  );
}

function RestsOn({
  claim,
  lookup,
  request,
  onRest,
}: {
  claim: Claim;
  lookup: Props["lookup"];
  request: Props["request"];
  onRest: (index: number) => void;
}) {
  const [shown, setShown] = useState(REST_PAGE);
  const ids = claim.restsOn;
  useEffect(() => request(ids.slice(0, shown)), [request, ids, shown]);
  return (
    <section className={`rcpt-rests${claim.kind === "inference" ? " dashed" : ""}`}>
      <span className="kicker">
        RESTS ON · {ids.length.toLocaleString("en-US")} {ids.length === 1 ? "RECORD" : "RECORDS"}
      </span>
      <ol>
        {ids.slice(0, shown).map((rid, i) => {
          const r = lookup(rid);
          return (
            <li key={rid}>
              <button type="button" onClick={() => onRest(i)}>
                {r === undefined ? null : r?.kind === "inference" ? (
                  <InferenceTag small />
                ) : (
                  <Tag tone="ink" small>
                    FACT
                  </Tag>
                )}
                <span>{r === undefined ? "Loading the record…" : (r?.text ?? rid)}</span>
              </button>
              {r && (
                <a
                  href={r.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${sourceName(r.sourceUrl)}`}
                >
                  ↗
                </a>
              )}
            </li>
          );
        })}
      </ol>
      {ids.length > shown && (
        <button type="button" className="linkbtn" onClick={() => setShown((n) => n + 50)}>
          Show {Math.min(50, ids.length - shown)} more of {(ids.length - shown).toLocaleString("en-US")} left ↓
        </button>
      )}
    </section>
  );
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button type="button" className="btn" onClick={() => navigator.clipboard.writeText(text).then(() => setDone(true))}>
      {done ? "COPIED" : "COPY CITATION"}
    </button>
  );
}
