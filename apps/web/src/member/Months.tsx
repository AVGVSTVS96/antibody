import type { NodeOf } from "@antibody/core";
import { count } from "../lib/format.ts";
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
  const at = months.indexOf(peak) / n;
  const edge = at < 0.2 ? "start" : at > 0.75 ? "end" : null;
  const band =
    window &&
    ([
      monthOffset(months, window[0]),
      monthOffset(months, window[1]) + 1 / (months.find((x) => x.month === window[1].slice(0, 7))?.days ?? 30),
    ] as const);
  return (
    <figure className="months">
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
        {!(peak.trades > 0 && edge === "start") && <span>{monthLabel(months[0]!.month)}</span>}
        {peak.trades > 0 && (
          <span style={edge ? undefined : { left: `${(months.indexOf(peak) + 0.5) * w}%` }} data-peak={edge ?? ""}>
            {monthLabel(peak.month)} · {count(peak.trades, "trade")}
          </span>
        )}
        {!(peak.trades > 0 && edge === "end") && <span>{monthLabel(months.at(-1)!.month)}</span>}
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
  return (
    <div className="baseline">
      <div className="baseline-charts">
        <div>
          <h3 className="kicker">
            {last}'s trades by month · all {everyone.length} months · gray = the {ws.windowDays} days the bill moved
          </h3>
          <MonthChart months={own} window={book.window} label={`${last}'s trades per month`} />
        </div>
        <div>
          <h3 className="kicker">Is that a spike? All {everyone.length} months, all members</h3>
          <MonthChart months={everyone} window={book.window} label="All members' trades per month" />
        </div>
      </div>
      <p>
        {mine.length ? (
          <>
            {last} filed {count(mine.length, "trade")} in{" "}
            {count(new Set(mine.map((t) => t.company)).size, "tied company", "tied companies")} across the full span.{" "}
            {inside} fall in the {ws.windowDays} days the bill moved
            {peak.trades > inside ? `; ${monthLabel(peak.month)} alone has ${peak.trades}` : ""}.{" "}
          </>
        ) : (
          <>{last} has no trades in tied companies in the data. </>
        )}
        Across all members, {ws.inside.toLocaleString("en-US")} of {ws.trades.toLocaleString("en-US")} trades (
        {share(ws.inside, ws.trades)}) fall in those {ws.windowDays} days, and {ws.windowDays} of{" "}
        {ws.days.toLocaleString("en-US")} days is {share(ws.windowDays, ws.days)}. The median member who traded filed{" "}
        {medianPerTrader(book)}. {mine.length > 0 && <Src ids={mine.map((t) => t.event.claim)} label="filings" />}
      </p>
    </div>
  );
}
