import { useMemo, useState } from "react";
import { count, day, nice, plainName, usd } from "../lib/format.ts";
import { memberHref, onLink } from "../lib/router.ts";
import { type Trade, tradeBook, windowCounts } from "../lib/trades.ts";
import { useModel } from "../ui/BillGate.tsx";
import { Src } from "../ui/receipt.tsx";
import { chipName } from "./Members.tsx";
import { TradeStrip } from "./TradeStrip.tsx";
import { type LedgerRow, methodWords } from "./ties.ts";
import "./money.css";

const OPEN = 8;
const PAGE = 24;

const monthYear = (iso: string) =>
  new Date(`${iso}T00:00:00Z`)
    .toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
    .toUpperCase();

function Traders({ row }: { row: LedgerRow }) {
  const { members, inWindow, byParty } = row.traders;
  const parties = (["R", "D", "I"] as const).filter((p) => p !== "I" || byParty.I > 0);
  return (
    <>
      <b>{count(members, "member")}</b>
      <span>
        {parties.map((p) => `${p} ${byParty[p]}`).join(" · ")} · {inWindow} in window
      </span>
    </>
  );
}

function MemberList({ trades }: { trades: Trade[] }) {
  const m = useModel();
  const by = new Map<string, Trade[]>();
  for (const t of trades) by.set(t.member, (by.get(t.member) ?? []).concat(t));
  const rows = [...by].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  return (
    <ul className="rowmembers">
      {rows.map(([id, ts]) => {
        const member = m.memberById.get(id as `member:${string}`)!.node;
        return (
          <li key={id}>
            <a href={memberHref(m.b.bill.id, member.props.bioguide)} onClick={onLink}>
              {chipName(member)}
            </a>
            <span>
              {count(ts.length, "trade")} · {windowCounts(ts).inside} in window
            </span>
            <Src ids={ts.map((t) => t.event.claim)} label="filings" />
          </li>
        );
      })}
    </ul>
  );
}

function Row({
  row,
  domain,
  window,
  open,
  onToggle,
}: {
  row: LedgerRow;
  domain: readonly [string, string];
  window: readonly [string, string] | null;
  open: boolean;
  onToggle: () => void;
}) {
  const { tie, trades, traders, gifts } = row;
  const { company, resolution, edge } = tie;
  const name = nice(tie.client.label);
  const first = trades.length ? [...new Set(trades.map((t) => t.edge.claims[0]!))] : [];
  return (
    <li className="lrow" data-open={open || undefined}>
      <div className="lc lc-client">
        <span className="lab">1 · Who lobbied it · fact</span>
        <h3>{name}</h3>
        <p className="meta">
          <Src ids={edge.claims} label={count(edge.props.reports, "filing")} />
          {" · "}
          {count(edge.props.quarters, "quarter")}
        </p>
      </div>
      <div className="lc lc-company">
        <span className="lab">2 · Listed company · inference</span>
        {company && resolution ? (
          <div className="cbox" data-inference={resolution.basis === "inference" || undefined}>
            <b>
              {company.ticker ?? "—"} {nice(company.label)}
            </b>
            <span>
              {methodWords(resolution.props.method)} · <Src ids={resolution.claims} label="why" />
            </span>
          </div>
        ) : (
          <div className="cbox none">
            <span>No listed company matched</span>
          </div>
        )}
      </div>
      <div className="lc lc-strip">
        <span className="lab">
          3 · When members traded the stock · {monthYear(domain[0])} → {monthYear(domain[1])}
        </span>
        <TradeStrip trades={trades} domain={domain} window={window} label={`${name}'s stock`} fade />
      </div>
      <div className="lc lc-who">
        <span className="lab">4 · Who traded</span>
        {traders.members ? (
          <>
            <button type="button" className="who" aria-expanded={open} onClick={onToggle}>
              <Traders row={row} />
            </button>
            <Src ids={first} label="filings" />
          </>
        ) : (
          <>
            <b>No member</b>
            <span>traded it</span>
          </>
        )}
      </div>
      <div className="lc lc-pac">
        <span className="lab">5 · PAC gave at least</span>
        {gifts ? (
          <>
            <b>{usd(gifts.usd)}</b>
            <span>
              to {count(gifts.members, "member")} · <Src ids={gifts.claims} label="FEC" />
            </span>
          </>
        ) : (
          <>
            <b>—</b>
            <span>none in the data</span>
          </>
        )}
      </div>
      {open && (
        <div className="lrow-open">
          <MemberList trades={trades} />
        </div>
      )}
    </li>
  );
}

/** The collapsed form of a row: one line naming the client, its stock and its counts. */
function Chip({ row, onOpen }: { row: LedgerRow; onOpen: () => void }) {
  const { company, resolution } = row.tie;
  const body = (
    <>
      <b>{plainName(row.tie.client.label, 30)}</b>
      <span>
        {[
          company?.ticker,
          resolution ? methodWords(resolution.props.method) : "no listed company matched",
          company && (row.traders.members ? count(row.traders.members, "member") : "no member traded it"),
          row.gifts && `${usd(row.gifts.usd)} PAC`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </>
  );
  return (
    <li>
      {company ? (
        <button type="button" className="lchip" onClick={onOpen}>
          {body}
        </button>
      ) : (
        <div className="lchip" data-none="">
          {body}
        </div>
      )}
    </li>
  );
}

/** One row per lobbying client: the client, the company it is matched to, when members traded its stock, who, and what its PAC gave. */
export function Ledger({ rows }: { rows: LedgerRow[] }) {
  const m = useModel();
  const book = tradeBook(m);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [members, setMembers] = useState<ReadonlySet<string>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const domain = book.span ?? (["2000-01-01", "2000-01-02"] as const);
  const full = useMemo(
    () => rows.filter((r, i) => (r.tie.company && i < OPEN) || opened.has(r.tie.client.id)),
    [rows, opened],
  );
  const rest = rows.filter((r) => !full.includes(r));
  const toggle = (set: ReadonlySet<string>, id: string) => {
    const next = new Set(set);
    if (!next.delete(id)) next.add(id);
    return next;
  };
  return (
    <div className="ledger">
      <div className="lhead" aria-hidden="true">
        <p>
          <b>1 · Who lobbied it</b>
          Fact · lda.gov filings
        </p>
        <p>
          <b>2 · Listed company</b>
          Inference · dashed
        </p>
        <p>
          <b>3 · When members traded the stock</b>
          Fact · filings · {monthYear(domain[0])} → {monthYear(domain[1])} · taller = more
        </p>
        <p>
          <b>4 · Who traded</b>
          Fact
        </p>
        <p>
          <b>5 · PAC gave ≥</b>
          FEC · a floor
        </p>
      </div>
      <ul className="lrows">
        {full.map((r) => (
          <Row
            key={r.tie.client.id}
            row={r}
            domain={domain}
            window={book.window}
            open={members.has(r.tie.client.id)}
            onToggle={() => setMembers((s) => toggle(s, r.tie.client.id))}
          />
        ))}
      </ul>
      {rest.length > 0 && (
        <div className="lrest">
          <p className="kicker">
            {rest.some((r) => r.tie.company)
              ? `${count(rest.length, "more client")} · rows collapsed · open one to see its trail`
              : `${count(rest.length, "client")} matched no listed company`}
            {rest.length > shown && (
              <>
                {" · "}
                <button type="button" className="linkbtn" onClick={() => setShown((n) => n + PAGE)}>
                  show {Math.min(PAGE, rest.length - shown)} more
                </button>
              </>
            )}
          </p>
          <ul className="lchips">
            {rest.slice(0, shown).map((r) => (
              <Chip key={r.tie.client.id} row={r} onOpen={() => setOpened((s) => toggle(s, r.tie.client.id))} />
            ))}
          </ul>
        </div>
      )}
      <p className="kicker lfloor">
        PAC column is a floor: only each member's 5 largest tied donors are kept, so smaller gifts are missing.
      </p>
    </div>
  );
}

export const windowLegend = (w: readonly [string, string] | null) =>
  w ? `The window: ${day(w[0])} to ${day(w[1])}` : null;
