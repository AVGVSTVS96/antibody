import { count, usd } from "../lib/format.ts";
import { type BillModel, memberShort } from "../lib/model.ts";
import { useFocus } from "./focus.ts";

const TOP = 6;

interface Row {
  id: string;
  name: string;
  figure: string;
  value: number;
}

type Group = [title: string, rows: Row[]];

function moneyGroups(m: BillModel): Group[] {
  return [
    [
      "Most tied-stock trades",
      [...m.members]
        .filter((v) => v.tradeCount)
        .sort((a, b) => b.tradeCount - a.tradeCount)
        .slice(0, TOP)
        .map((v) => ({
          id: v.node.id,
          name: memberShort(v.node),
          figure: count(v.tradeCount, "trade"),
          value: v.tradeCount,
        })),
    ],
    [
      "Most PAC money from tied companies",
      [...m.members]
        .filter((v) => v.fundedUsd > 0)
        .sort((a, b) => b.fundedUsd - a.fundedUsd)
        .slice(0, TOP)
        .map((v) => ({ id: v.node.id, name: memberShort(v.node), figure: usd(v.fundedUsd), value: v.fundedUsd })),
    ],
    [
      "Companies traded by the most members",
      m.actors
        .filter((a) => a.traders.size)
        .sort((a, b) => b.traders.size - a.traders.size)
        .slice(0, TOP)
        .map((a) => ({ id: a.id, name: a.short, figure: count(a.traders.size, "member"), value: a.traders.size })),
    ],
  ];
}

function lobbyGroups(m: BillModel): Group[] {
  return [
    [
      "Top lobbying clients",
      [...m.actors]
        .filter((a) => a.reports)
        .sort((a, b) => b.reports - a.reports)
        .slice(0, TOP)
        .map((a) => ({ id: a.id, name: a.short, figure: count(a.reports, "report"), value: a.reports })),
    ],
    [
      "Most-lobbied sections",
      m.sections
        .filter((v) => v.lobbied)
        .sort((a, b) => b.lobbied - a.lobbied)
        .slice(0, TOP)
        .map((v) => ({
          id: `section:${v.s.id}`,
          name: `${m.secLabel(v)} ${v.s.heading}`,
          figure: count(v.lobbied, "report"),
          value: v.lobbied,
        })),
    ],
    [
      "Sponsors and members who added text",
      m.members
        .filter((v) => v.sponsor || v.inserted.length)
        .sort((a, b) => Number(b.sponsor) - Number(a.sponsor) || b.inserted.length - a.inserted.length)
        .slice(0, TOP)
        .map((v) => ({
          id: v.node.id,
          name: memberShort(v.node),
          figure: v.sponsor ? "sponsor" : `added ${count(v.inserted.length, "section")}`,
          value: v.sponsor ? 1 : 0.6,
        })),
    ],
  ];
}

export function Ranked({ m, view, plain = false }: { m: BillModel; view: "map" | "money"; plain?: boolean }) {
  const focus = useFocus();
  const groups = (view === "money" ? moneyGroups(m) : lobbyGroups(m)).filter(([, rows]) => rows.length);
  return (
    <aside className="ranked" aria-label="Biggest ties">
      {groups.map(([title, rows]) => {
        const peak = Math.max(...rows.map((r) => r.value));
        return (
          <div key={title} className="rk">
            <div className="cap">{title}</div>
            <ol>
              {rows.map((r) => {
                const body = (
                  <>
                    <span className="nm">{r.name}</span>
                    <span className="n">{r.figure}</span>
                    <i style={{ width: `${Math.max(4, (r.value / peak) * 100)}%` }} />
                  </>
                );
                return (
                  <li key={r.id}>
                    {plain ? (
                      <div className="rkrow">{body}</div>
                    ) : (
                      <button
                        type="button"
                        className="rkrow"
                        aria-pressed={focus.pinned === r.id}
                        onClick={() => focus.pin(focus.pinned === r.id ? null : r.id)}
                        onPointerEnter={() => focus.setHover(r.id)}
                        onPointerLeave={() => focus.setHover(null)}
                      >
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </aside>
  );
}
