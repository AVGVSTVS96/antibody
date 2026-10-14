import type { NodeOf } from "@antibody/core";
import { count } from "../lib/format.ts";
import { ruleUrl } from "../lib/receipt-copy.ts";
import {
  type Month,
  medianPerTrader,
  monthly,
  monthOffset,
  tradeBook,
  windowCounts,
  windowShare,
} from "../lib/trades.ts";
import { share } from "../money/Common.tsx";
import { lastName } from "../money/Members.tsx";
import { useModel } from "../ui/BillGate.tsx";
import { Src } from "../ui/receipt.tsx";

const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`)
    .toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
    .toUpperCase();

const HEIGHT = 110;

/** One bar per calendar month; the gray band is the bill's window, drawn to the day. */
function MonthChart({
  months,
  window,
  label,
}: {
  months: Month[];
  window: readonly [string, string] | null;
  label: string;
}) {
  const n = months.length;
  const peak = months.reduce((a, x) => (x.trades > a.trades ? x : a), months[0]!);
  const w = 100 / n;
  const at = (months.indexOf(peak) + 0.5) / n;
  const band =
    window &&
    ([
      monthOffset(months, window[0]),
      monthOffset(months, window[1]) + 1 / (months.find((x) => x.month === window[1].slice(0, 7))?.days ?? 30),
    ] as const);
  return (
    <figure className="months">
      <p className="months-peak">
        {peak.trades > 0 && (
          <span style={{ left: `${at * 100}%`, transform: `translateX(-${at * 100}%)` }}>
            {monthLabel(peak.month)} · {count(peak.trades, "trade")}
          </span>
        )}
      </p>
      <svg width="100%" height={HEIGHT} role="img" aria-label={label}>
        {band && (
          <rect className="months-band" x={`${band[0] * w}%`} width={`${(band[1] - band[0]) * w}%`} height={HEIGHT} />
        )}
        {months.map((x, i) => {
          const h = peak.trades ? Math.max(x.trades ? 2 : 0, Math.round((x.trades / peak.trades) * (HEIGHT - 6))) : 0;
          return (
            <rect key={x.month} className="months-bar" x={`${i * w}%`} y={HEIGHT - h} width={`${w}%`} height={h}>
              <title>{`${monthLabel(x.month)}: ${count(x.trades, "trade")}`}</title>
            </rect>
          );
        })}
        <line className="months-base" x1="0" x2="100%" y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} />
      </svg>
      <figcaption>
        <span>{monthLabel(months[0]!.month)}</span>
        <span>{monthLabel(months.at(-1)!.month)}</span>
      </figcaption>
    </figure>
  );
}

/** "Is that a spike?": the member's trades in every month of the span, and everyone's, with the window in gray. */
export function Months({ member }: { member: NodeOf<"member"> }) {
  const m = useModel();
  const book = tradeBook(m);
  const mine = book.byMember.get(member.id) ?? [];
  const everyone = monthly(book);
  const ws = windowShare(book);
  if (!book.span || !ws || !book.window) return null;
  const own = monthly(book, member.id);
  const peak = own.reduce((a, x) => (x.trades > a.trades ? x : a), own[0]!);
  const inside = windowCounts(mine).inside;
  const last = lastName(member);
  const bill = m.b.bill.display;
  return (
    <div className="baseline">
      <div className="baseline-charts" data-solo={mine.length === 0 || undefined}>
        {mine.length > 0 ? (
          <div>
            <h3 className="kicker">
              {last}'s trades by month · all {everyone.length} months · gray = the {ws.windowDays} days the bill moved
            </h3>
            <MonthChart months={own} window={book.window} label={`${last}'s trades per month`} />
          </div>
        ) : (
          <p className="baseline-none">
            {last} filed no trades in companies that lobbied on {bill}.
          </p>
        )}
        <div>
          <h3 className="kicker">Is that a spike? All {everyone.length} months, all members</h3>
          <MonthChart months={everyone} window={book.window} label="All members' trades per month" />
        </div>
      </div>
      <p>
        {mine.length > 0 && (
          <>
            {last} filed {count(mine.length, "trade")} in{" "}
            {count(
              new Set(mine.map((t) => t.company)).size,
              "company that lobbied on " + bill,
              `companies that lobbied on ${bill}`,
            )}{" "}
            across the full span. {inside} fall in the {ws.windowDays} days the bill moved
            {peak.trades > inside ? `; ${monthLabel(peak.month)} alone has ${peak.trades}` : ""}.{" "}
          </>
        )}
        Across all members, {ws.inside.toLocaleString("en-US")} of {ws.trades.toLocaleString("en-US")} trades (
        {share(ws.inside, ws.trades)}) fall in those {ws.windowDays} days, and {ws.windowDays} of{" "}
        {ws.days.toLocaleString("en-US")} days is {share(ws.windowDays, ws.days)}. The median member who traded filed{" "}
        {medianPerTrader(book)}. {mine.length > 0 && <Src ids={mine.map((t) => t.event.claim)} label="filings" />}{" "}
        <a href={ruleUrl("trade-window")} target="_blank" rel="noopener noreferrer">
          Rule: trade window ↗
        </a>
      </p>
    </div>
  );
}
