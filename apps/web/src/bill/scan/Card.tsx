import { count, musd } from "../../lib/format.ts";
import { Sources, Src, useClaims } from "../../ui/claims.tsx";
import {
  type CardData,
  type GroupCard,
  type MemberCardData,
  money,
  monthYear,
  type PacCard,
  type TradesCard,
} from "./cards.ts";

function Linked({ id, label }: { id: string | null; label: string }) {
  const { claim } = useClaims();
  return id && claim(id) ? <Src id={id} label={label} /> : <>{label}</>;
}

const span = (first: string | null, last: string | null) => {
  if (!first || !last) return "";
  const a = monthYear(first);
  const b = monthYear(last);
  return a === b ? `, ${a}` : `, ${a} to ${b}`;
};

const one = (n: number, a: string, b: string) => (n === 1 ? a : b);

const bar = (value: number, max: number, box = 64) => Math.max(4, Math.round((value / Math.max(max, 1)) * box));

interface Head {
  mark: "co" | "sec" | "mem";
  name: string;
  tag?: string | null;
  onClear: () => void;
}

function Header({ mark, name, tag, onClear }: Head) {
  return (
    <div className="sc-card-head">
      <span className={`sc-glyph sc-${mark}`} aria-hidden="true" />
      <h3>{name}</h3>
      {tag && <span className="sc-tag">{tag}</span>}
      <button type="button" className="sc-unpin" onClick={onClear} aria-label={`Unpin ${name}`}>
        Pinned
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 3l6 6M9 3L3 9" />
        </svg>
      </button>
    </div>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: "money" }) {
  return (
    <div className="sc-stat">
      <b className={tone ? `sc-v sc-${tone}` : "sc-v"}>{value}</b>
      <span className="sc-l">{label}</span>
    </div>
  );
}

export function Card({ data, onClear }: { data: CardData; onClear: () => void }) {
  return (
    <aside className="sc-card" data-kind={data.kind} aria-label={`${data.name}, pinned`}>
      {data.kind === "trades" && <TradesBody d={data} onClear={onClear} />}
      {data.kind === "pac" && <PacBody d={data} onClear={onClear} />}
      {data.kind === "sections" && <GroupBody d={data} onClear={onClear} />}
      {data.kind === "member" && <MemberBody d={data} onClear={onClear} />}
    </aside>
  );
}

function owners(list: string[]) {
  return list.length ? <span className="sc-sub">{list.join(", ")}</span> : null;
}

function TradesBody({ d, onClear }: { d: TradesCard; onClear: () => void }) {
  const max = d.rows[0]?.trades ?? 1;
  return (
    <>
      <Header mark="co" name={d.name} tag={d.ticker} onClear={onClear} />
      <div className="sc-stats">
        <Stat
          tone="money"
          value={d.reports.toLocaleString("en-US")}
          label={one(d.reports, "lobbying report names the bill", "lobbying reports name the bill")}
        />
        <Stat
          value={String(d.rows.length)}
          label={one(d.rows.length, "member traded its stock", "members traded its stock")}
        />
        <Stat value={String(d.trades)} label={`${one(d.trades, "trade", "trades")}${span(d.first, d.last)}`} />
      </div>
      <div className="sc-list">
        <div className="sc-list-head">
          <span>All {d.rows.length} members who traded it</span>
          <span>Trades</span>
        </div>
        <ul className="sc-rows">
          {d.rows.map((r) => (
            <li key={r.id}>
              <span className="sc-nm">
                <Linked id={r.claim} label={r.name} />
                {owners(r.owners)}
              </span>
              <span className="sc-bar" aria-hidden="true">
                <i style={{ width: bar(r.trades, max) }} />
              </span>
              <span className="sc-num">{r.trades}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="sc-foot">
        Trades come from House and Senate disclosures. A tie is where to look, not proof of gain.
        {d.unread > 0 &&
          ` ${count(d.unread, "of these members has", "of these members have")} paper filings we have not read yet, so counts may be low.`}
      </p>
      <Sources ids={d.sources} max={4} />
    </>
  );
}

function PacBody({ d, onClear }: { d: PacCard; onClear: () => void }) {
  const max = Math.max(...d.buckets.map((b) => b.members), 1);
  return (
    <>
      <Header mark="co" name={d.name} tag={d.ticker} onClear={onClear} />
      <div className="sc-stats">
        <Stat tone="money" value={money(d.total)} label="given before the vote" />
        <Stat value={String(d.members)} label={`${one(d.members, "member got", "members got")} some${d.parties}`} />
        <Stat value={money(d.average)} label="per member, on average" />
      </div>
      <div className="sc-list">
        <div className="sc-list-head">
          <span>How much each member got</span>
          <span>Members</span>
        </div>
        <ul className="sc-rows sc-money">
          {d.buckets.map((b) => (
            <li key={b.label}>
              <span className="sc-nm">{b.label}</span>
              <span className="sc-bar sc-fill" aria-hidden="true">
                <i style={{ width: `${Math.max(3, (b.members / max) * 100)}%` }} />
              </span>
              <span className="sc-num">{b.members}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="sc-foot">
        From FEC filings. A PAC is matched to a company by a published rule, so these ties are inferences, drawn dashed.
        Giving before a vote is legal and common; this shows where to look.
      </p>
      <Sources ids={d.sources} max={4} />
    </>
  );
}

function GroupBody({ d, onClear }: { d: GroupCard; onClear: () => void }) {
  const top = d.rows.slice(0, 8);
  const max = Math.max(...top.map((r) => Math.abs(r.musd)), 1);
  const net = d.netMusd;
  return (
    <>
      <Header mark="sec" name={d.name} tag={count(d.count, "section")} onClear={onClear} />
      <div className="sc-stats">
        <Stat value={String(d.count)} label={one(d.count, "section in this title", "sections in this title")} />
        <Stat
          value={d.priced ? money(Math.abs(net) * 1e6) : "—"}
          label={
            d.priced
              ? `${net < 0 ? "cut from" : "added to"} the deficit, ${d.priced} of ${d.count} priced`
              : "CBO priced none of them"
          }
        />
        <Stat
          value={d.scored ? String(d.noNews) : "—"}
          label={d.scored ? `of ${d.scored} got no news coverage` : "news coverage not measured"}
        />
      </div>
      <div className="sc-list">
        <div className="sc-list-head">
          <span>Biggest sections in the title</span>
          <span>CBO deficit effect</span>
        </div>
        {top.length ? (
          <ul className="sc-rows sc-sections">
            {top.map((r) => (
              <li key={r.id} className={r.flagged ? "sc-flag" : r.musd < 0 ? "sc-save" : ""}>
                <span className="sc-nm">
                  <Linked id={r.claim} label={r.heading} />
                  {r.estimate && <span className="sc-sub sc-est">estimate</span>}
                </span>
                <span
                  className={`sc-bar${r.musd < 0 ? " sc-hollow" : ""}${r.estimate ? " sc-est" : ""}`}
                  aria-hidden="true"
                >
                  <i style={{ width: bar(Math.abs(r.musd), max, 56) }} />
                </span>
                <span className="sc-num sc-wide">{musd(r.musd)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sc-none">CBO gave no figure for any section in this title.</p>
        )}
      </div>
      <p className="sc-foot">
        Each figure is CBO’s estimate of the section’s effect on the deficit, linked to its source.
        {d.flagged > 0 &&
          " Orange marks a section flagged as buried: big stakes and almost no news. That label is an inference."}
        {top.some((r) => r.estimate) &&
          " An estimate splits a CBO group figure evenly across its sections, also an inference."}
      </p>
    </>
  );
}

function MemberBody({ d, onClear }: { d: MemberCardData; onClear: () => void }) {
  const trades = d.view === "trades";
  const max = d.rows[0]?.value ?? 1;
  return (
    <>
      <Header mark="mem" name={d.name} tag={d.seat} onClear={onClear} />
      <div className="sc-stats">
        <Stat value={String(d.rows.length)} label={trades ? "tied companies traded" : "tied companies gave"} />
        <Stat
          value={trades ? String(d.total) : money(d.total)}
          label={trades ? `trades${span(d.first, d.last)}` : "from their PACs, before the vote"}
        />
      </div>
      <div className="sc-list">
        <div className="sc-list-head">
          <span>{trades ? "Companies traded" : "Companies whose PACs gave"}</span>
          <span>{trades ? "Trades" : "Given"}</span>
        </div>
        <ul className={`sc-rows${trades ? "" : " sc-money"}`}>
          {d.rows.map((r) => (
            <li key={r.id}>
              <span className="sc-nm">
                <Linked id={r.claim} label={r.name} />
                {trades && owners(r.owners)}
              </span>
              <span className="sc-bar" aria-hidden="true">
                <i style={{ width: bar(r.value, max) }} />
              </span>
              <span className="sc-num sc-wide">{trades ? r.value : money(r.value)}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="sc-foot">
        {trades
          ? "Trades come from House and Senate disclosures. A tie is where to look, not proof of gain."
          : "From FEC filings, matched to companies by a published rule. Giving before a vote is legal and common."}
        {d.unread && " This member’s paper filings have not been read yet, so counts may be low."}
      </p>
    </>
  );
}

export function CompactCard({ data, more, onClear }: { data: CardData; more: boolean; onClear: () => void }) {
  const sum =
    data.kind === "trades"
      ? `${count(data.reports, "lobbying report")} name the bill. ${count(data.rows.length, "member")} traded its stock, ${count(data.trades, "trade")} in all.`
      : data.kind === "pac"
        ? `${money(data.total)} given before the vote to ${count(data.members, "member")}${data.parties}.`
        : data.kind === "sections"
          ? `${count(data.count, "section")}${data.priced ? `, ${data.netMusd < 0 ? "cutting" : "adding"} ${money(Math.abs(data.netMusd) * 1e6)} ${data.netMusd < 0 ? "from" : "to"} the deficit` : ", none priced by CBO"}.`
          : `${data.seat}. ${data.view === "trades" ? `${count(data.total, "trade")} in ${count(data.rows.length, "tied company", "tied companies")}.` : `${money(data.total)} from tied companies’ PACs.`}`;
  const rows =
    data.kind === "trades"
      ? data.rows.map((r) => ({
          id: r.id,
          name: r.name,
          value: `${r.trades} ${r.trades === 1 ? "trade" : "trades"}`,
          claim: r.claim,
        }))
      : data.kind === "pac"
        ? data.buckets.map((b) => ({ id: b.label, name: b.label, value: count(b.members, "member"), claim: null }))
        : data.kind === "sections"
          ? data.rows.slice(0, 8).map((r) => ({ id: r.id, name: r.heading, value: musd(r.musd), claim: r.claim }))
          : data.rows.map((r) => ({
              id: r.id,
              name: r.name,
              value: data.view === "trades" ? `${r.value} ${r.value === 1 ? "trade" : "trades"}` : money(r.value),
              claim: r.claim,
            }));
  return (
    <aside className="sc-card sc-compact" data-kind={data.kind} aria-label={`${data.name}, pinned`}>
      <div className="sc-card-head">
        <span
          className={`sc-glyph sc-${data.kind === "sections" ? "sec" : data.kind === "member" ? "mem" : "co"}`}
          aria-hidden="true"
        />
        <h3>{data.name}</h3>
        {more ? (
          <span className="sc-hint">Swipe for next {data.kind === "sections" ? "title" : "company"}</span>
        ) : (
          <button type="button" className="sc-unpin" onClick={onClear} aria-label={`Unpin ${data.name}`}>
            Pinned
          </button>
        )}
      </div>
      <p className="sc-sum">{sum}</p>
      <ul className="sc-rows">
        {rows.map((r) => (
          <li key={r.id}>
            <span className="sc-nm">
              <Linked id={r.claim} label={r.name} />
            </span>
            <span className="sc-num">{r.value}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
