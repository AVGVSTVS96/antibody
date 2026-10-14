import { BIG_STAKES } from "@antibody/core";
import { memo, type ReactNode, useEffect, useRef } from "react";
import { RULES_URL, usd } from "../lib/format.ts";
import { geometry, logHeight, quietRun, type TapeRow } from "../lib/tape.ts";
import { Tag } from "../ui/primitives.tsx";
import { Src } from "../ui/receipt.tsx";
import { type Contrast, commonPlace, cost, csv, FILTERS, lobbyingOf, years } from "./derive.ts";
import { type Ctx, Notes } from "./Notes.tsx";
import { PAGE, type Reader } from "./reader.ts";
import { hover } from "./store.ts";

const KINDS = { headline: "LOUD", quiet: "QUIET AND COSTLY", other: "" } as const;
const clean = (s: string) => s.replace(/\s+([.,;:])/g, "$1");

const GEO = geometry(false, false);

const BASE = 62;

function Mark({ row, flat }: { row: TapeRow; flat: boolean }) {
  const stub = !flat && row.musd == null;
  const h = flat ? (row.kind === "other" ? 28 : 46) : stub ? 2 : Math.min(logHeight(row.musd!, GEO), 52);
  const cut = !flat && (row.musd ?? 0) < 0;
  return (
    <svg className="x-mark-svg" width="96" height="92" aria-hidden="true">
      <rect
        className={stub ? "x-mark-stub" : `x-mark-bar x-mark-${row.kind}`}
        x="41"
        y={stub ? BASE - 1 : cut ? BASE : BASE - h}
        width="14"
        height={h}
      />
      <line className="x-mark-base" x1="0" x2="96" y1={BASE} y2={BASE} />
    </svg>
  );
}

function Stats({ row, ctx }: { row: TapeRow; ctx: Ctx }) {
  const f = row.view.figure;
  const l = lobbyingOf(ctx.m, row.id);
  const period =
    f && row.view.s.dollars.find((d) => d.estimateId === f.estimateId && d.baseline === "current-law")?.period;
  const quiet = row.kind === "quiet";
  return (
    <div className="x-stats">
      <div>
        <strong data-hot={(quiet && f && !row.evenSplit && Math.abs(f.musd) >= BIG_STAKES.dollarsMusd) || undefined}>
          {cost(row)}
        </strong>
        {f ? <Src ids={f.claims} label={`CBO · ${period ? years(period) : "CBO"}`} /> : <span>NO CBO FIGURE</span>}
      </div>
      <div>
        <strong>{row.articles ?? "—"}</strong>
        {row.view.s.attention ? <Src ids={row.view.s.attention.claim} label="ARTICLES" /> : <span>NOT MEASURED</span>}
      </div>
      <div>
        <strong data-hot={(quiet && l.reports >= BIG_STAKES.reports) || undefined}>{l.reports}</strong>
        {l.reports ? <Src ids={l.claims} label="LOBBY REPORTS" /> : <span>LOBBY REPORTS</span>}
      </div>
    </div>
  );
}

const Row = memo(function Row({
  row,
  ctx,
  open,
  flash,
  onToggle,
  withWords,
}: {
  row: TapeRow;
  ctx: Ctx;
  open: boolean;
  flash: boolean;
  onToggle: (id: string) => void;
  withWords?: boolean;
}) {
  const s = row.view.s;
  const tag = KINDS[row.kind];
  const where = row.place.slice(-2).join(" · ");
  const score = s.score;
  return (
    <article
      className="x-row"
      id={`section-${row.routeId}`}
      data-row={row.id}
      data-kind={row.kind}
      data-open={open || undefined}
      data-flash={flash || undefined}
      onPointerEnter={() => hover.set(row.id)}
      onPointerLeave={() => hover.set(null)}
    >
      <div className="x-mark">
        <Mark row={row} flat={ctx.tape.flat} />
        <i className="x-pip" aria-hidden="true" />
        {open && (
          <span className="x-no">
            № {row.index + 1}/{ctx.tape.rows.length}
          </span>
        )}
      </div>
      <div className="x-body">
        <p className="x-meta">
          <span>
            {row.label}
            {where && <span className="x-where"> · {where}</span>}
          </span>
          {tag && <Tag tone={row.kind === "quiet" ? "quiet" : "ink"}>{tag}</Tag>}
          {row.late && <Tag tone="ink">ADDED LATE</Tag>}
        </p>
        <h3>
          <button type="button" aria-expanded={open} onClick={() => onToggle(row.id)}>
            {row.heading}
          </button>
        </h3>
        <p className="x-sum">
          {[row.label, cost(row), `${row.articles ?? "?"} ARTICLES`, row.lobbying ? `${row.lobbying} REPORTS` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {(open || withWords) && (
          <blockquote className="x-words">
            <p className="x-fine">THE LAW'S OWN WORDS · FIRST 200 CHARACTERS</p>
            <p>
              {clean(s.preview)}
              {s.preview.length >= 200 && "…"}
            </p>
            <Src ids={s.claims[0]!} label={`READ ALL ${s.words.toLocaleString("en-US")} WORDS ON GOVINFO`} />
          </blockquote>
        )}
        {open && score && (
          <p className="x-fine x-ink">
            SCORED {KINDS[row.kind] || "OTHER"}
            {score.buried != null && `, BUILT FROM THE FIVE INPUTS HERE (SCORE ${score.buried.toFixed(2)})`}{" "}
            <Src ids={score.claim} label="HOW" />
          </p>
        )}
      </div>
      {open ? <Notes row={row} ctx={ctx} /> : <Stats row={row} ctx={ctx} />}
    </article>
  );
});

function Panel({ r, ctx, why }: { r: Reader; ctx: Ctx; why: string | null }) {
  const lateKnown = ctx.tape.lateKnown;
  return (
    <aside className="x-panel">
      <div>
        <p className="kicker">STEP 2 · READ IT</p>
        <h2>The bill, with the margin notes it never had.</h2>
      </div>
      <fieldset className="x-filters">
        <legend className="x-sr">Filter the sections</legend>
        {FILTERS.map((f) => {
          const off = f.id === "late" && !lateKnown;
          return (
            <button
              key={f.id}
              type="button"
              data-filter={f.id}
              aria-pressed={r.filter === f.id}
              disabled={off}
              title={off ? (ctx.tape.lateReason ?? undefined) : undefined}
              onClick={() => r.setFilter(f.id)}
            >
              <span>
                <i data-mark={f.id} aria-hidden="true" />
                <span className="x-long">{f.label}</span>
                <span className="x-short">{f.short}</span>
              </span>
              <b>{off ? "—" : r.tally[f.id]}</b>
            </button>
          );
        })}
      </fieldset>
      <fieldset className="x-sorts">
        <legend className="x-sr">Sort the sections</legend>
        {(["order", "cost", "news"] as const).map((s) => (
          <button key={s} type="button" aria-pressed={r.sort === s} onClick={() => r.setSort(s)}>
            {s === "order" ? "BILL ORDER" : s.toUpperCase()}
          </button>
        ))}
      </fieldset>
      <div className="x-how">
        <b>HOW A MARK TURNS YELLOW</b>
        <p>
          Three things at once: big stakes ({usd(BIG_STAKES.dollarsMusd * 1e6)} in a CBO figure for the section, or
          about {BIG_STAKES.reports} lobbying reports), quiet in the news, and late or off-topic. Every row shows its
          inputs, never just the verdict. Computed figures like off-topic distance are drawn dashed and tagged
          INFERENCE.
        </p>
        {why && <p>On this bill: {why}.</p>}
        <a href={`${RULES_URL}#buried-v1`} target="_blank" rel="noopener noreferrer" className="x-fine">
          HOW WE SCORE ↗
        </a>
      </div>
      <p className="x-keys">
        <kbd>J</kbd> <kbd>K</kbd> next or previous section · <kbd>Enter</kbd> opens its money
      </p>
    </aside>
  );
}

/** Loads the next page when it scrolls near; the button is the same thing for keyboards. */
function Sentinel({ onSeen, children }: { onSeen: () => void; children: ReactNode }) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && onSeen(), { rootMargin: "800px" });
    io.observe(el.current!);
    return () => io.disconnect();
  }, [onSeen]);
  return <span ref={el}>{children}</span>;
}

export function ReadIt({
  r,
  ctx,
  pair,
  why,
  name,
}: {
  r: Reader;
  ctx: Ctx;
  pair: Contrast | null;
  why: string | null;
  name: string;
}) {
  const { tape } = ctx;
  const run = r.filter === "quiet" && r.sort === "order" ? quietRun(tape) : null;
  const shown = r.list.slice(0, r.shown);
  const filter = FILTERS.find((f) => f.id === r.filter)!;
  const more = r.shown < r.list.length;
  return (
    <div className="x-read">
      <Panel r={r} ctx={ctx} why={why} />
      <div className="x-list">
        <header className="x-list-head">
          <b>
            {run
              ? `${[...commonPlace(run.rows[0]!.place, run.rows.at(-1)!.place), `${run.rows.length} OF THE ${tape.quiet} QUIET MARKS RUN ${run.rows[0]!.label} TO ${run.rows.at(-1)!.label}`].join(" · ").toUpperCase()}`
              : `${filter.label.toUpperCase()} · ${r.list.length.toLocaleString("en-US")} ${r.list.length === 1 ? "SECTION" : "SECTIONS"} · ${r.sort === "order" ? "BILL ORDER" : `BY ${r.sort.toUpperCase()}`}`}
          </b>
          <span>
            SHOWING {Math.min(shown.length, r.list.length).toLocaleString("en-US")} OF{" "}
            {r.list.length.toLocaleString("en-US")}
          </span>
        </header>
        {shown.map((row) => (
          <Row
            key={row.id}
            row={row}
            ctx={ctx}
            open={r.open.has(row.id)}
            flash={r.flash === row.id}
            onToggle={r.toggle}
          />
        ))}
        {!r.list.length && <p className="x-empty">No section matches this filter.</p>}
        {r.filter === "quiet" && pair && (
          <>
            <header className="x-list-head x-contrast">
              <b>FOR CONTRAST · A LOUD SECTION, READ THE SAME WAY</b>
              <span>SAME FIVE INPUTS · SAME RULES</span>
            </header>
            <Row
              row={pair.loud}
              ctx={ctx}
              open={r.open.has(pair.loud.id)}
              flash={false}
              onToggle={r.toggle}
              withWords
            />
          </>
        )}
        <footer className="x-list-foot">
          {more ? (
            <Sentinel key={r.shown} onSeen={r.more}>
              <button type="button" className="btn" onClick={r.more}>
                LOAD {Math.min(PAGE, r.list.length - r.shown)} MORE
              </button>
            </Sentinel>
          ) : (
            <span>{r.list.length > 0 && "END OF THE LIST"}</span>
          )}
          <button
            type="button"
            className="btn"
            disabled={!r.list.length}
            onClick={() => {
              const url = URL.createObjectURL(new Blob([csv(r.list, tape)], { type: "text/csv" }));
              const a = Object.assign(document.createElement("a"), { href: url, download: `${name}-${r.filter}.csv` });
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            EXPORT THESE {r.list.length.toLocaleString("en-US")} AS CSV ↓
          </button>
        </footer>
      </div>
    </div>
  );
}
