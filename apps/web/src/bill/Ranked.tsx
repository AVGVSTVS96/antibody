import { count, usd } from "../lib/format.ts";
import { type BillModel, memberShort } from "../lib/model.ts";
import { useFocus } from "./focus.ts";

const TOP = 6;

interface Row {
  id: string;
  name: string;
  figure: string;
}

export function Ranked({ m }: { m: BillModel }) {
  const focus = useFocus();
  const byTrades = [...m.members]
    .filter((v) => v.tradeCount)
    .sort((a, b) => b.tradeCount - a.tradeCount)
    .slice(0, TOP)
    .map((v) => ({ id: v.node.id, name: memberShort(v.node), figure: count(v.tradeCount, "trade") }));
  const byPac = [...m.members]
    .filter((v) => v.fundedUsd > 0)
    .sort((a, b) => b.fundedUsd - a.fundedUsd)
    .slice(0, TOP)
    .map((v) => ({ id: v.node.id, name: memberShort(v.node), figure: usd(v.fundedUsd) }));
  const byCompany = m.actors
    .filter((a) => a.traders.size)
    .sort((a, b) => b.traders.size - a.traders.size)
    .slice(0, TOP)
    .map((a) => ({ id: a.id, name: a.short, figure: count(a.traders.size, "member") }));
  const groups: [string, Row[]][] = [
    ["Most tied-stock trades", byTrades],
    ["Most PAC money from tied companies", byPac],
    ["Companies traded by the most members", byCompany],
  ];
  return (
    <aside className="ranked" aria-label="Biggest ties">
      {groups
        .filter(([, rows]) => rows.length)
        .map(([title, rows]) => (
          <div key={title} className="rk">
            <div className="cap">{title}</div>
            <ol>
              {rows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    aria-pressed={focus.pinned === r.id}
                    onClick={() => focus.pin(focus.pinned === r.id ? null : r.id)}
                    onPointerEnter={() => focus.setHover(r.id)}
                    onPointerLeave={() => focus.setHover(null)}
                  >
                    <span>{r.name}</span>
                    <span className="n">{r.figure}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        ))}
    </aside>
  );
}
