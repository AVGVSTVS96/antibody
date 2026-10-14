import { useMemo, useState } from "react";
import { count, day, nice, plainName } from "../lib/format.ts";
import { byAmount, byOwner, ownerWords, type Trade, windowCounts } from "../lib/trades.ts";
import { TradeStrip } from "../money/TradeStrip.tsx";
import { useModel } from "../ui/BillGate.tsx";
import { Src } from "../ui/receipt.tsx";
import type { Scope } from "./scope.ts";
import { milestones } from "./votes.ts";

const SHOWN = 12;
const DAY = 86_400_000;
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const monthDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const monthName = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();

/** The dates at the chart's edges: whole months around the member's trades, the window and the milestones. */
function domainOf(dates: string[]): [string, string] {
  const sorted = [...dates].sort();
  const from = sorted[0]!.slice(0, 7);
  const last = sorted.at(-1)!;
  const end = new Date(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(5, 7)), 1));
  return [`${from}-01`, iso(end.getTime())];
}

function axisMonths(domain: [string, string], max = 7) {
  const out: { at: number; date: string }[] = [];
  const [a, b] = [ms(domain[0]), ms(domain[1])];
  for (let t = new Date(a); t.getTime() < b; t.setUTCMonth(t.getUTCMonth() + 1))
    out.push({ at: (t.getTime() - a) / (b - a), date: iso(t.getTime()) });
  const step = Math.ceil(out.length / max);
  return out.filter((_, i) => i % step === 0);
}

/** Where each milestone falls; those within a tenth of the chart share one label. */
function marks(domain: [string, string], events: { date: string; label: string }[]) {
  const [a, b] = [ms(domain[0]), ms(domain[1])];
  const groups: { at: number; text: string[] }[] = [];
  for (const e of events) {
    const at = (ms(e.date) - a) / (b - a);
    const text = `${monthDay(e.date)} ${e.label}`;
    const last = groups.at(-1);
    if (last && at - last.at < 0.1) last.text.push(text);
    else groups.push({ at, text: [text] });
  }
  return groups;
}

export function Trail({ trades, scope }: { trades: Trade[]; scope: Scope }) {
  const m = useModel();
  const book = m.span;
  const [all, setAll] = useState(false);
  const events = useMemo(() => milestones(m).filter((e) => !book || e.date >= book[0]), [m, book]);
  const domain = useMemo(
    () => domainOf([...trades.map((t) => t.event.date), ...(book ?? []), ...events.map((e) => e.date)]),
    [trades, book, events],
  );
  const rows = useMemo(() => {
    const by = new Map<string, Trade[]>();
    for (const t of trades) by.set(t.company, (by.get(t.company) ?? []).concat(t));
    return [...by]
      .map(([id, ts]) => ({ actor: m.actorById.get(id)!, trades: ts }))
      .sort((x, y) => y.trades.length - x.trades.length || x.actor.label.localeCompare(y.actor.label));
  }, [trades, m]);
  const shown = all ? rows : rows.slice(0, SHOWN);
  const span = ms(domain[1]) - ms(domain[0]);
  const pct = (d: string) => `${((ms(d) - ms(domain[0])) / span) * 100}%`;
  const inside = windowCounts(trades).inside;
  const owners = byOwner(trades);
  const amounts = byAmount(trades);
  const first = trades.map((t) => t.event.date).sort();

  return (
    <div className="trail">
      <ul className="legend trail-legend">
        <li>
          <i data-mark="tick" />
          Bought (up)
        </li>
        <li>
          <i data-mark="tick" />
          Sold (down)
        </li>
        {book && (
          <li>
            <i data-mark="band" />
            While the bill moved
          </li>
        )}
      </ul>
      <div className="trail-body">
        <div className="trail-plot" style={{ gridTemplateRows: `18px repeat(${shown.length}, auto) 18px` }}>
          <div className="trail-over" style={{ gridRow: `1 / span ${shown.length + 2}` }} aria-hidden="true">
            {book && (
              <i
                className="trail-band"
                style={{ left: pct(book[0]), width: `${((ms(book[1]) - ms(book[0]) + DAY) / span) * 100}%` }}
              />
            )}
            {events.map((e) => (
              <i key={`${e.date}${e.label}`} className="trail-line" style={{ left: pct(e.date) }} />
            ))}
            {marks(domain, events).map((g) => (
              <span
                key={g.at}
                className="trail-mark"
                data-flip={g.at > 0.6 || undefined}
                style={g.at > 0.6 ? { right: `${(1 - g.at) * 100}%` } : { left: `${g.at * 100}%` }}
              >
                {g.text.join(" · ")}
              </span>
            ))}
            {axisMonths(domain).map((x) => (
              <span key={x.date} className="trail-month" style={{ left: `${x.at * 100}%` }}>
                {monthName(x.date)}
              </span>
            ))}
          </div>
          {shown.map(({ actor, trades: ts }, i) => {
            const sections = scope.rows.filter((r) => scope.bySection.get(r.id)?.has(actor.id));
            return (
              <div key={actor.id} className="trail-row" style={{ gridRow: i + 2 }}>
                <p className="trail-label">
                  <b>{plainName(actor.label, 26)}</b>
                  <span>
                    {actor.ticker ?? "—"} · lobbied{" "}
                    {sections.length ? sections.map((r) => r.label).join(" ") : m.b.bill.display}
                  </span>
                </p>
                <div className="trail-strip">
                  <TradeStrip
                    trades={ts}
                    domain={domain}
                    window={null}
                    label={`Trades in ${nice(actor.label)}`}
                    size="chart"
                    band={false}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div className="trail-notes">
          <p className="trail-big">
            <strong>{trades.length}</strong>
            <span>
              {count(trades.length, "trade")} in {rows.length === 1 ? "this stock" : `these ${rows.length} stocks`},{" "}
              {monthDay(first[0]!)} {first[0]!.slice(0, 4)} to {monthDay(first.at(-1)!)} {first.at(-1)!.slice(0, 4)}
            </span>
            <Src ids={trades.map((t) => t.event.claim)} label="filings" />
          </p>
          {book && (
            <p className="trail-big" data-tone="window">
              <strong>{inside}</strong>
              <span>
                fell inside the window, {day(book[0])} to {day(book[1])}
              </span>
              {inside > 0 && <Src ids={trades.filter((t) => t.inWindow).map((t) => t.event.claim)} label="filings" />}
            </p>
          )}
          <p className="trail-who">
            <b>
              {owners.length === 1
                ? `All ${trades.length} in the ${ownerWords(owners[0]!.owner)}`
                : owners.map((o) => `${o.count} in the ${ownerWords(o.owner)}`).join(", ")}
            </b>
            <span>
              {amounts.length === 1
                ? `All in one range: ${amounts[0]!.amount.replace(/\s*-\s*/, "–")}`
                : `Ranges as filed: ${amounts.map((a) => `${a.amount.replace(/\s*-\s*/, "–")} (${a.count})`).join(", ")}`}
            </span>
          </p>
        </div>
      </div>
      {rows.length > SHOWN && (
        <button type="button" className="linkbtn" onClick={() => setAll((x) => !x)}>
          {all ? `show the top ${SHOWN}` : `show all ${rows.length} stocks`}
        </button>
      )}
      <p className="trail-events kicker">{events.map((e) => `${monthDay(e.date)} ${e.label}`).join(" · ")}</p>
      <p className="kicker">Stocks are ordered by how many trades the member filed in them, then by name.</p>
    </div>
  );
}
