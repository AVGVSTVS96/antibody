import { useMemo, useRef, useState } from "react";
import { isPassage, memberLine, monthly, monthName, niceMax, passageDate, traders } from "../lib/derive.ts";
import { count, day } from "../lib/format.ts";
import { useWidth } from "../lib/hooks.ts";
import type { BillModel } from "../lib/model.ts";
import { Sources } from "../ui/claims.tsx";
import { Section } from "./Section.tsx";

const SEATS = 535;

export function Trades({ m }: { m: BillModel }) {
  const all = useMemo(() => traders(m), [m]);
  const top = all.slice(0, 6);
  const peak = Math.max(1, ...top.map((t) => t.v.tradeCount));
  const unread = m.unread.R + m.unread.D + m.unread.I;
  const cut = passageDate(m);
  const own = m.b.votes.some((r) => isPassage(r));
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(40);
  const span = m.span;
  const widest = all.length
    ? [all.flatMap((t) => t.v.trades.flatMap((x) => x.props.events.map((e) => e.date))).sort()]
    : [];
  const dates = widest[0] ?? [];
  const range = dates.length ? `${monthShort(dates[0]!)} to ${monthShort(dates.at(-1)!)}` : "";
  return (
    <Section id="trades" title="Members who traded tied stock">
      <p className="lead narrow">
        Members of Congress must report their stock trades. A company is tied to the bill if it lobbied on it. Big
        companies are traded all the time, so this shows where to look, not a link to any vote.
      </p>
      <div className="trades-g">
        <div className="seats">
          <p className="bigfig">
            {m.tradersDuring} of {SEATS}
          </p>
          <p className="seat-l">
            members traded a tied stock between the first text and {m.b.bill.law ? "signing" : "the latest action"}.
          </p>
          <SeatGrid filled={m.tradersDuring} />
          <p className="fine">
            One dot per seat.
            {unread ? ` ${unread} members filed on paper and haven’t been read yet, so they may be missing.` : ""}
          </p>
        </div>
        <div className="toptr">
          <header>
            <h3>Most trades</h3>
            <span className="tr-bar-h">
              Dark before {own ? "the vote" : m.b.bill.law ? "signing" : "the latest action"}, light after
            </span>
            <span className="tr-vote-h">Voted</span>
            <span className="tr-n-h">Trades</span>
          </header>
          <p className="bar-key">
            <span>
              <i className="b" />
              Before {own ? "the vote" : m.b.bill.law ? "signing" : "the latest action"}
            </span>
            <span>
              <i className="a" />
              After
            </span>
          </p>
          {top.length ? (
            <ul>
              {top.map((t) => (
                <li key={t.v.node.id}>
                  <span className="who">{memberLine(t.v.node.label)}</span>
                  <span className="tr-bar" aria-hidden="true" style={{ width: `${(t.v.tradeCount / peak) * 100}%` }}>
                    <i className="b" style={{ flexGrow: t.before }} />
                    <i className="a" style={{ flexGrow: t.after }} />
                  </span>
                  <span className="vote">{t.vote ?? (m.b.votes.length ? "No vote" : "")}</span>
                  <b className="num">{t.v.tradeCount.toLocaleString("en-US")}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">No member trades in tied companies were found.</p>
          )}
          <footer>
            {all.length > 6 ? (
              <button type="button" className="link" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                {open ? "Hide the list" : `All ${all.length} who traded${range ? `, ${range}` : ""}`}
              </button>
            ) : (
              <span />
            )}
            <span>Source: House and Senate trade reports</span>
          </footer>
        </div>
      </div>
      {open && (
        <ul className="all-traders">
          {all.slice(0, shown).map((t) => (
            <li key={t.v.node.id}>
              <b>{memberLine(t.v.node.label)}</b>
              <span className="num">{count(t.v.tradeCount, "trade")}</span>
              <span className="vote">{t.vote ?? ""}</span>
              <Sources ids={t.v.trades.flatMap((x) => x.claims)} max={2} />
            </li>
          ))}
          {shown < all.length && (
            <li className="more">
              <button type="button" className="link" onClick={() => setShown((s) => s + 60)}>
                Show more ({all.length - shown} left)
              </button>
            </li>
          )}
        </ul>
      )}
      <Monthly m={m} span={span} />
    </Section>
  );
}

const monthShort = (iso: string) =>
  new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

function SeatGrid({ filled }: { filled: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const w = useWidth(ref, 350);
  const pitch = 10.6;
  const cols = Math.max(10, Math.floor((w + 2) / pitch));
  const rows = Math.ceil(SEATS / cols);
  const step = w / cols;
  return (
    <div ref={ref} className="seat-grid">
      <svg
        width={w}
        height={rows * step}
        viewBox={`0 0 ${w} ${rows * step}`}
        role="img"
        aria-label={`${filled} of ${SEATS} seats filled`}
      >
        {Array.from({ length: SEATS }, (_, i) => (
          <circle
            // biome-ignore lint/suspicious/noArrayIndexKey: seats are positional
            key={i}
            cx={(i % cols) * step + step / 2}
            cy={Math.floor(i / cols) * step + step / 2}
            r={Math.min(3.6, step * 0.34)}
            fill={i < filled ? "var(--ink)" : "var(--quiet)"}
          />
        ))}
      </svg>
    </div>
  );
}

function Monthly({ m, span }: { m: BillModel; span: [string, string] | null }) {
  const { months, total } = useMemo(() => monthly(m), [m]);
  const box = useRef<HTMLDivElement>(null);
  const w = useWidth(box, 1200);
  const [hover, setHover] = useState<number | null>(null);
  if (!months.length) return null;
  const phone = w < 560;
  const H = phone ? 252 : 240;
  const L = phone ? 34 : 44;
  const R = 2;
  const T = phone ? 64 : 44;
  const B = 36;
  const top = niceMax(Math.max(...months.map((x) => x.n)));
  const bw = (w - L - R) / months.length;
  const X = (i: number) => L + i * bw;
  const Y = (n: number) => T + (H - T - B) * (1 - n / top);
  const base = H - B;
  const peak = months.reduce((a, x) => (x.n > a.n ? x : a), months[0]!);
  const idx = (iso: string) => months.findIndex((x) => x.key === iso.slice(0, 7));
  const firstPass = m.b.votes.filter(isPassage).sort((a, b) => a.date.localeCompare(b.date))[0];
  const marks = [
    span && { at: span[0], label: `First text, ${day(span[0]).replace(/, \d{4}$/, "")}` },
    firstPass && {
      at: firstPass.date,
      label: `${firstPass.chamber} passes, ${day(firstPass.date).replace(/, \d{4}$/, "")}`,
    },
    span && {
      at: span[1],
      label: `${m.b.bill.law ? "Signed" : "Latest action"}, ${day(span[1]).replace(/, \d{4}$/, "")}`,
    },
  ].filter((x): x is { at: string; label: string } => !!x && idx(x.at) >= 0);
  const yticks = Array.from({ length: 6 }, (_, i) => (top / 5) * i).filter((v, i, a) => a.indexOf(v) === i);
  const years = months.map((x, i) => ({ x, i })).filter(({ x, i }) => i === 0 || x.key.endsWith("-01"));
  const inSpan = peak.during;
  return (
    <div className="monthly" ref={box}>
      <header>
        <h3>Tied-stock trades by all members, each month</h3>
        <span>
          {total.toLocaleString("en-US")} trades.{span ? " Shaded: while the bill was moving" : ""}
        </span>
      </header>
      <svg
        width={w}
        height={H}
        viewBox={`0 0 ${w} ${H}`}
        role="img"
        aria-label={`Trades per month, ${months.length} months, ${total} trades`}
      >
        {yticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={w - R} y1={Y(v)} y2={Y(v)} stroke="var(--rule)" />
            <text x={L - 10} y={Y(v) + 4} textAnchor="end" className="ax">
              {v}
            </text>
          </g>
        ))}
        {span && idx(span[0]) >= 0 && idx(span[1]) >= 0 && (
          <rect
            x={X(idx(span[0]))}
            y={T - 6}
            width={X(idx(span[1]) + 1) - X(idx(span[0]))}
            height={base - T + 6}
            fill="var(--wash)"
          />
        )}
        {months.map((x, i) => (
          <rect
            key={x.key}
            x={X(i) + 1.5}
            y={Y(x.n)}
            width={Math.max(2, bw - 3)}
            height={base - Y(x.n)}
            rx="1.5"
            fill={x.during || !span ? "var(--ink)" : "var(--quiet-dot)"}
            opacity={hover == null || hover === i ? 1 : 0.55}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
          >
            <title>{`${monthName(x.key)}: ${count(x.n, "trade")}`}</title>
          </rect>
        ))}
        <line x1={L} x2={w - R} y1={base} y2={base} stroke="var(--ink-3)" />
        {years.map(({ x, i }, k) => (
          <g key={x.key}>
            <line x1={X(i)} x2={X(i)} y1={base} y2={base + 5} stroke="var(--ink-3)" />
            {!(i === 0 && years[k + 1] && (years[k + 1]!.i - i) * bw < 64) && (
              <text x={X(i) + 4} y={base + 20} className="ax">
                {i === 0 && !x.key.endsWith("-01") ? monthShort(`${x.key}-01`) : x.key.slice(0, 4)}
              </text>
            )}
          </g>
        ))}
        {marks.map((k, j) => {
          const x = X(idx(k.at)) + bw * (Number(k.at.slice(8, 10)) / 31);
          const row = phone ? j : j === 1 ? 1 : 0;
          const end = j === 2 && !phone;
          return (
            <g key={k.at + k.label} pointerEvents="none">
              <line x1={x} x2={x} y1={4 + row * 16} y2={base} stroke="var(--ink)" strokeDasharray="1 3" />
              <text x={end ? x - 5 : x + 5} y={15 + row * 16} textAnchor={end ? "end" : "start"} className="mk-l">
                {k.label}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="fine">
        The busiest month was {monthName(peak.key)}, with {count(peak.n, "trade")}
        {span
          ? inSpan
            ? ", while the bill moved"
            : peak.key < span[0].slice(0, 7)
              ? ", before the bill existed"
              : ", after it became law"
          : ""}
        .{span ? " Months while it moved are drawn darker." : ""} The window runs a year before the first text and a
        year after the last action.
      </p>
    </div>
  );
}
