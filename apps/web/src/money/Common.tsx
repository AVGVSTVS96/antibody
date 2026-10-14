import { count } from "../lib/format.ts";
import { ruleUrl } from "../lib/receipt-copy.ts";
import type { BaseRate, WindowShare } from "../lib/trades.ts";

export const share = (n: number, of: number) => {
  const p = (100 * n) / Math.max(1, of);
  return `${p > 0 && p < 10 ? p.toFixed(1) : Math.round(p)}%`;
};

/** Every tie beside how common it is: the same table for every party, counted from all members the bundle draws. */
export function Common({ rate, noun, window }: { rate: BaseRate; noun: string; window?: WindowShare | null }) {
  return (
    <div className="common">
      <table>
        <caption className="kicker">Who appears · same table for every party</caption>
        <thead>
          <tr>
            <th scope="col">Party</th>
            <th scope="col">Members</th>
            <th scope="col">Got a gift</th>
            <th scope="col">Traded</th>
            <th scope="col">Both</th>
          </tr>
        </thead>
        <tbody>
          {(["R", "D", "I"] as const).map((p) => (
            <tr key={p}>
              <th scope="row">{p}</th>
              <td>{rate.byParty[p].members}</td>
              {(["gifted", "traded", "both"] as const).map((k) => (
                <td key={k}>
                  {rate.byParty[p][k]} · {share(rate.byParty[p][k], rate.byParty[p].members)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Being in this table is common. Of the {count(rate.members, "member")} the bundle draws, {rate.gifted}{" "}
        {rate.gifted === 1 ? "has" : "have"} a PAC gift from one of {noun} (counting only each member's 5 largest tied
        donors), {rate.traded} traded one of the stocks, and {rate.both} did both. The records show dates and amounts,
        not motive, or that any trade or vote followed from any gift.
      </p>
      {window && (
        <p>
          {count(window.inside, "trade")} of {window.trades.toLocaleString("en-US")} (
          {share(window.inside, window.trades)}) in tied stocks fall in the window, and the window is{" "}
          {count(window.windowDays, "day")} of the {window.days.toLocaleString("en-US")} the trades span (
          {share(window.windowDays, window.days)}). An even spread of trades would put the same share in both.
        </p>
      )}
      <p className="kicker">
        <a href={ruleUrl("tied-stock")} target="_blank" rel="noopener noreferrer">
          Rule: tied stock ↗
        </a>
        {" · "}
        <a href={ruleUrl("trade-window")} target="_blank" rel="noopener noreferrer">
          Rule: trade window ↗
        </a>
      </p>
    </div>
  );
}
