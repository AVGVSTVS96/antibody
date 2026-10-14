import { type PointerEvent, useMemo, useRef, useState } from "react";
import { count, day } from "../lib/format.ts";
import type { BillModel } from "../lib/model.ts";
import { memberHref, onLink } from "../lib/router.ts";
import { monthly, monthOffset, ownerWords, tradeBook } from "../lib/trades.ts";
import { InferenceTag, Note } from "../ui/primitives.tsx";
import { Src } from "../ui/receipt.tsx";
import { useWidth } from "../ui/useWidth.ts";
import { ChapterPage } from "./ChapterPage.tsx";
import { type Ch6Data, ch6, shortDay } from "./data.ts";
import { Cap, Person } from "./parts.tsx";

const H = 128;
const PAD_TOP = 34;
const PIN = 22;

/** Pin centers left to right, kept inside the chart and at least a pin apart, nudged from the right edge first. */
function spreadPins(xs: number[], width: number): number[] {
  const out = [...xs];
  for (let i = out.length - 1; i >= 0; i--) out[i] = Math.min(out[i]!, (out[i + 1] ?? width) - PIN - 2);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(out[i]!, PIN / 2 + i * (PIN + 2));
  return out;
}

function DayChart({ c }: { c: Ch6Data }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const n = c.days.length;
  const slot = width / Math.max(n, 1);
  const max = Math.max(1, ...c.perDay);
  const at = (e: PointerEvent) => {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    return Math.min(n - 1, Math.max(0, Math.floor(x / slot)));
  };
  const shown = pinned ?? hover;
  const date = shown == null ? null : c.days[shown]!;
  const mark = c.milestones.filter((x) => x.date === date);
  const peakAt = c.peak ? c.days.indexOf(c.peak.date) : -1;
  const atDay = c.milestones.map((x) => Math.round(c.days.indexOf(x.date) * slot + slot / 2));
  const pins = spreadPins(atDay, width);
  const tail = (i: number) => (i < n * 0.15 ? "start" : i > n * 0.85 ? "end" : "middle");
  return (
    <div className="day-chart" ref={box} data-noswipe>
      {width > 0 && (
        <svg
          width={width}
          height={H + PAD_TOP}
          role="img"
          aria-label={`${count(c.trades, "trade")} by day, ${shortDay(c.days[0]!)} to ${shortDay(c.days.at(-1)!)}. Busiest day ${c.peak ? `${shortDay(c.peak.date)}, ${c.peak.trades}` : "none"}.`}
          onPointerDown={(e) => setPinned(pinned === at(e) ? null : at(e))}
          onPointerMove={(e) => (e.buttons ? setPinned(at(e)) : setHover(at(e)))}
          onPointerLeave={() => setHover(null)}
        >
          {c.milestones.map((x, i) => (
            <g key={x.letter} className="pin">
              <path d={`M${atDay[i]} ${H + PAD_TOP}V${PAD_TOP - 4}L${pins[i]} ${PIN}`} />
              <circle cx={pins[i]} cy={PIN / 2} r={PIN / 2} />
              <text x={pins[i]} y={PIN / 2 + 4}>
                {x.letter}
              </text>
            </g>
          ))}
          {c.perDay.map((v, i) => (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: one bar per day
              key={i}
              className="day-bar"
              data-on={shown === i || undefined}
              style={{ "--i": i } as React.CSSProperties}
              x={Math.round(i * slot)}
              width={Math.max(1, Math.round(slot) - (slot > 4 ? 1 : 0))}
              y={PAD_TOP + H - Math.max(v ? 2 : 1, Math.round((v / max) * (H - 16)))}
              height={Math.max(v ? 2 : 1, Math.round((v / max) * (H - 16)))}
            />
          ))}
          {c.peak && peakAt >= 0 && (
            <text
              className="peak"
              x={Math.round(peakAt * slot + slot / 2)}
              y={PAD_TOP + H - Math.round(H - 16) - 6}
              textAnchor={tail(peakAt)}
            >
              {c.peak.trades} TRADES · {shortDay(c.peak.date).toUpperCase()}
            </text>
          )}
        </svg>
      )}
      <div className="day-axis">
        <span>{shortDay(c.days[0]!).toUpperCase()}</span>
        <span>{shortDay(c.days[Math.floor(n / 2)]!).toUpperCase()}</span>
        <span>{shortDay(c.days.at(-1)!).toUpperCase()}</span>
      </div>
      <p className="day-read" aria-live="off">
        {date
          ? `${shortDay(date).toUpperCase()} · ${count(c.perDay[shown!]!, "trade")}${mark.length ? ` · ${mark.map((x) => `${x.letter} ${x.text}`).join("; ")}` : ""}`
          : "Drag across the chart to read a day. Tap a day to pin it."}
      </p>
    </div>
  );
}

function MonthChart({ m, c }: { m: BillModel; c: Ch6Data }) {
  const book = tradeBook(m);
  const months = useMemo(() => monthly(book), [book]);
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const max = Math.max(1, ...months.map((x) => x.trades));
  const slot = width / Math.max(months.length, 1);
  const win = book.window;
  const from = win ? monthOffset(months, win[0]) : 0;
  const to = win ? monthOffset(months, win[1]) + 1 / 30 : 0;
  const h = 96;
  return (
    <div className="month-chart" ref={box}>
      {width > 0 && (
        <svg
          width={width}
          height={h}
          role="img"
          aria-label={`${count(months.length, "month")} of trades in tied companies, all members. ${count(c.trades, "trade")} fall in the bill's window.`}
        >
          {win && <rect className="win" x={from * slot} width={Math.max(2, (to - from) * slot)} y={0} height={h} />}
          {months.map((x, i) => {
            const bh = Math.max(x.trades ? 2 : 1, Math.round((x.trades / max) * (h - 8)));
            return (
              <rect
                key={x.month}
                className="month-bar"
                x={Math.round(i * slot) + 1}
                width={Math.max(1, Math.round(slot) - 2)}
                y={h - bh}
                height={bh}
              />
            );
          })}
        </svg>
      )}
      <div className="day-axis">
        <span>{months[0] && monthName(months[0].month)}</span>
        {win && <span className="gray">GRAY = THE {count(c.days.length, "day").toUpperCase()} ABOVE</span>}
        <span>{months.at(-1) && monthName(months.at(-1)!.month)}</span>
      </div>
    </div>
  );
}

const monthName = (ym: string) => day(`${ym}-01`).replace(/ \d+,/, "").toUpperCase();

export default function Ch6({ m }: { m: BillModel }) {
  const c = useMemo(() => ch6(m), [m]);
  const { data } = c;
  const id = m.b.bill.id;
  const book = tradeBook(m);
  const lead = data.leaders[0];
  const maxLead = lead?.trades ?? 1;
  const all = data.all;
  const offAccount = data.leaders.find((l) => l.owners.some((o) => o.owner !== "self"));
  const ownerLine = offAccount
    ? `${offAccount.owners
        .filter((o) => o.owner !== "self")
        .map(
          (o) =>
            `${o.trades} of ${offAccount.label.replace(/ \(.*\)$/, "")}'s ${offAccount.trades} trades in the window ${o.trades === 1 ? "is" : "are"} in the ${ownerWords(o.owner)}`,
        )
        .join("; ")}. The filing does not say who made the decisions.`
    : undefined;
  const baseline = all
    ? `Trades in tied companies are counted from a year before the bill to a year after the law. ${all.inside.toLocaleString("en-US")} of ${all.trades.toLocaleString("en-US")} (${(100 * all.tradeShare).toFixed(1)}%) fall in the ${all.windowDays} days the bill moved; ${all.windowDays} of ${all.days.toLocaleString("en-US")} days is ${(100 * all.dayShare).toFixed(1)}%. The median member who traded filed ${data.median} in all. ${data.traders} of the ${data.tradedAll} who traded filed in the window.`
    : undefined;

  return (
    <ChapterPage
      head={c.head}
      lede={c.lede}
      inference={false}
      prose={[
        "A tie is not proof of gain. These are routine disclosures. No link between any trade and any vote is claimed.",
        baseline,
        ownerLine,
        ...data.gaps.map((g) => g.text),
      ]}
      chips={
        data.trades > 0 && (
          <>
            <Src ids={data.claims} label="HOUSE + SENATE DISCLOSURES" />
            <a
              className="rule-chip"
              href={m.b.rules.find((r) => r.id === "tied-stock")?.url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
            >
              <InferenceTag />
              <span>TIE ↗</span>
            </a>
          </>
        )
      }
      cta={
        lead
          ? {
              title: `Open ${lead.label.replace(/ \(.*\)$/, "")}'s page`,
              hint: "SAME PAGE FOR EVERY MEMBER",
              href: memberHref(id, lead.id.slice(7)),
            }
          : null
      }
      share
    >
      {data.trades > 0 && data.window && (
        <>
          <Note title="A TIE IS NOT PROOF OF GAIN">
            These are routine disclosures. No link between any trade and any vote is claimed.
          </Note>
          <section>
            <Cap aside={<span className="axis">{count(data.trades, "trade").toUpperCase()}</span>}>
              1 bar = 1 day · height = trades
            </Cap>
            <DayChart c={data} />
            {data.milestones.length > 0 && (
              <ol className="miles">
                {data.milestones.map((x) => (
                  <li key={x.letter}>
                    <b>{x.letter}</b>
                    {x.claim ? (
                      <Src ids={x.claim} label={`${shortDay(x.date).toUpperCase()}  ${x.text.toUpperCase()}`} />
                    ) : (
                      <span>{x.text}</span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
          {all && (
            <section>
              <Cap>Is that a spike? All {book.span ? monthly(book).length : 0} months, all members</Cap>
              <MonthChart m={m} c={data} />
              <p>{baseline}</p>
              <p className="chips">
                <Src
                  ids={book.all.map((t) => t.event.claim)}
                  label={`ALL ${all.trades.toLocaleString("en-US")} TRADES`}
                />
              </p>
            </section>
          )}
          <section>
            <Cap>Most trades in the window</Cap>
            <ul className="lead-rows">
              {data.leaders.map((l) => (
                <li key={l.id}>
                  <a className="plain" href={memberHref(id, l.id.slice(7))} onClick={onLink}>
                    <Person label={l.label} />
                  </a>
                  <i style={{ width: `${(100 * l.trades) / maxLead}%` }} />
                  <b>{l.trades}</b>
                </li>
              ))}
            </ul>
            {ownerLine && <p className="small">{ownerLine}</p>}
          </section>
        </>
      )}
      {data.gaps.length > 0 && (
        <Note title="GAPS SHOWN, NOT HIDDEN" tone="dashed">
          {data.gaps.map((g) => (
            <p key={g.id}>{g.text}</p>
          ))}
        </Note>
      )}
    </ChapterPage>
  );
}
