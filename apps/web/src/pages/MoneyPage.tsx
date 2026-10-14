import { useEffect, useMemo, useState } from "react";
import { count, day, deficitWords } from "../lib/format.ts";
import type { BillModel, SectionView } from "../lib/model.ts";
import { type BillRoute, billHref, navigate, onLink, sectionHref } from "../lib/router.ts";
import { buildTape } from "../lib/tape.ts";
import { baseRate, rankMembers, tradeBook, tradeGaps, windowShare } from "../lib/trades.ts";
import { Common } from "../money/Common.tsx";
import { Ledger } from "../money/Ledger.tsx";
import { MemberChips } from "../money/Members.tsx";
import { billTies, ledger, matchSummary, sectionTies } from "../money/ties.ts";
import { usePhone } from "../money/usePhone.ts";
import { useModel } from "../ui/BillGate.tsx";
import { NotFound } from "../ui/NotFound.tsx";
import { InferenceTag, Kicker, Note, Section, Tag, Wrap } from "../ui/primitives.tsx";
import { Src } from "../ui/receipt.tsx";
import { Tape } from "../ui/Tape.tsx";
import "../money/money.css";

const SHOWN = 12;

function Headline({ m, v, ties, matched }: { m: BillModel; v: SectionView; ties: number; matched: number }) {
  if (!ties)
    return v.named ? (
      <>None of the clients drawn here named {m.secLabel(v)}.</>
    ) : (
      <>No lobbying filing names {m.secLabel(v)}.</>
    );
  if (!matched) return <>{count(ties, "client")} named it. None matched a listed company.</>;
  return (
    <>Who traded the stock of the {matched === 1 ? "company" : `${matched} companies`} whose lobbyists named it.</>
  );
}

const filingsName = (n: number) => `${count(n, "filing")} ${n === 1 ? "names" : "name"}`;

const UNMATCHED = " Unmatched with the most reports: ";

function Recall({ text }: { text: string }) {
  const [about, list] = text.split(UNMATCHED);
  return (
    <>
      <p>{about}</p>
      {list && (
        <details>
          <summary>Largest unmatched, by reports</summary>
          <p>{list}</p>
        </details>
      )}
    </>
  );
}

function Follow({ v }: { v: SectionView }) {
  const m = useModel();
  const phone = usePhone();
  const [wide, setWide] = useState(false);
  const book = tradeBook(m);
  const tape = useMemo(() => buildTape(m), [m]);
  const own = useMemo(() => sectionTies(m, v), [m, v]);
  const bill = useMemo(() => billTies(m), [m]);
  const bare = own.length === 0;
  const ties = bare ? (wide ? bill : []) : own;
  const rows = useMemo(() => ledger(m, ties), [m, ties]);
  const companies = useMemo(() => new Set(rows.flatMap((r) => (r.company ? [r.company.id] : []))), [rows]);
  const ranked = useMemo(() => rankMembers(m, companies), [m, companies]);
  const rate = useMemo(() => baseRate(m, companies), [m, companies]);
  const [all, setAll] = useState(false);
  const { bill: card } = m.b;
  const clients = m.b.nodes.filter((n) => n.kind === "client").length;
  const inWindow = ranked.filter((r) => r.inWindow > 0);
  const party = (list: typeof ranked) =>
    (["R", "D", "I"] as const)
      .map((p) => [p, list.filter((r) => r.member.node.props.party === p).length] as const)
      .filter(([p, n]) => n > 0 || p !== "I")
      .map(([p, n]) => `${p} ${n}`)
      .join(" · ");
  const recall = m.b.gaps.find((g) => g.kind === "entity_recall" && /lobbying clients/.test(g.text));
  const kind = v.kind === "buried" ? "quiet" : v.kind === "headline" ? "headline" : null;

  const tapeView = (
    <Tape
      tape={tape}
      current={v.s.id}
      currentLabel={phone ? undefined : "The section whose money you are following"}
      pinned={phone}
      legend={!phone}
      axis={!phone}
      caption={
        phone
          ? "The tape · tap a mark to re-aim"
          : "The tape · same tape, carried across every step · click any mark to re-aim this page"
      }
      onSelect={(row) => navigate(sectionHref(card.id, row.routeId))}
    />
  );

  return (
    <div className="money">
      {phone && tapeView}
      <Wrap className="page money-head">
        <Kicker>
          STEP 3 · FOLLOW THE MONEY · {card.display} › {m.secLabel(v)} {v.s.heading}
        </Kicker>
        <div className="money-top">
          <div>
            <h1>
              <Headline m={m} v={v} ties={own.length} matched={companies.size} />
            </h1>
            <p className="lead">
              {bare ? (
                <>
                  {v.named > 0 && (
                    <>
                      {filingsName(v.named)} it; none is from a client drawn here (only the{" "}
                      {clients.toLocaleString("en-US")} busiest of the bill's{" "}
                      {m.b.lobbying.clients.toLocaleString("en-US")} lobbying clients are).{" "}
                    </>
                  )}
                  {bill.length > 0 &&
                    `${count(
                      bill.reduce((n, t) => n + t.edge.props.reports, 0),
                      "filing",
                    )} from ${count(bill.length, "client")} name ${card.display} as a whole, so there is no stock to trace from ${m.secLabel(v)}.`}
                </>
              ) : (
                <>
                  {filingsName(v.named)} {m.secLabel(v)}; the {v.drawn.toLocaleString("en-US")} from{" "}
                  {own.length === 1 ? "this client" : `these ${own.length} clients`} {v.drawn === 1 ? "is" : "are"}{" "}
                  drawn. Each row is one company: the clients that merge into it, the dates members of Congress traded
                  its stock, and what its PAC gave (a floor).
                </>
              )}
            </p>
            <p className="money-sec">
              {kind && (
                <Tag tone={kind === "quiet" ? "quiet" : "ink"}>
                  {kind === "quiet" ? "QUIET AND COSTLY" : "HEADLINE"}
                </Tag>
              )}
              {v.figure && (
                <>
                  <span>
                    {m.secLabel(v)} {deficitWords(v.figure.musd)} · {v.figure.estimate.baselineLabel}
                  </span>
                  <Src ids={v.figure.claims} label="CBO" />
                </>
              )}
              {!v.s.inFinal && <Tag>NOT IN THE FINAL TEXT</Tag>}
              {!v.figure && <span>{m.secLabel(v)} · no CBO figure</span>}
              <Src ids={`sections/${v.s.id}`} label="SECTION" />
              <a href={billHref(card.id)} onClick={onLink}>
                The x-ray
              </a>
            </p>
          </div>
          <Note title="Read this first">
            A trade in a company that lobbied is a tie, not proof. Nothing here says a member knew, acted on it, or
            gained. Members trade large companies all the time, so every count below sits beside how common it is.
          </Note>
        </div>
      </Wrap>

      {!phone && tapeView}

      {bare && (
        <Section kicker="Bill-wide view" title="The clients that named the bill as a whole">
          {bill.length ? (
            <>
              <p className="lead">
                No filing ties a client to {m.secLabel(v)}, so there is nothing to trace for it alone. The bill-wide
                view lists the {count(bill.length, "client")} that named {card.display} without naming a section, and
                what members did with their stock.
              </p>
              {!wide && (
                <button type="button" className="btn go" onClick={() => setWide(true)}>
                  Show the bill-wide view
                </button>
              )}
            </>
          ) : (
            <p className="lead">No lobbying filing names this bill in the data.</p>
          )}
        </Section>
      )}

      {rows.length > 0 && (
        <Section
          kicker={`The ledger · one row per company · left to right is the trail${bare ? " · bill-wide" : ""}`}
          aside={
            <ul className="legend legend-trade">
              <li>
                <i data-mark="tick" />
                Buy (up), sell (down) in the window
              </li>
              <li>
                <i data-mark="tick" data-out="" />
                Outside it
              </li>
              {book.window && (
                <li>
                  <i data-mark="band" />
                  The window: {day(book.window[0])} to {day(book.window[1])}
                </li>
              )}
            </ul>
          }
        >
          <Ledger rows={rows} />
        </Section>
      )}

      {rows.length > 0 && (
        <Section kicker="6 · The members behind the ticks">
          <div className="behind">
            {companies.size > 0 ? (
              <div className="behind-who">
                <p className="behind-n">
                  <strong>{ranked.length}</strong>
                  <span>
                    {ranked.length === 1 ? "member traded" : "members traded"}{" "}
                    {companies.size === 1 ? "this stock" : `at least one of these ${companies.size} stocks`} in the
                    data. {inWindow.length} did it inside the window ({party(inWindow)}). {party(ranked)} overall.
                  </span>
                </p>
                <MemberChips ranked={all ? ranked : ranked.slice(0, SHOWN)} />
                {ranked.length > SHOWN && (
                  <button type="button" className="linkbtn" onClick={() => setAll((x) => !x)}>
                    {all ? "show fewer" : `show all ${ranked.length}`}
                  </button>
                )}
                <p className="kicker">
                  {companies.size === 1
                    ? "Ordered by name, one rule for everyone. Not by party, not by dollars."
                    : `Ordered by one rule for everyone: how many of these ${companies.size} companies a member traded, then by name. The number beside a name is that count. Not by party, not by dollars.`}
                </p>
              </div>
            ) : (
              <p className="lead">
                No client matched a listed company, so there is no stock to follow from {m.secLabel(v)} and no member to
                list.
              </p>
            )}
            <Note title="The weakest link: client → company" tone="dashed">
              <InferenceTag small />
              <p>
                Lobbying filings name a client, not a stock. {matchSummary(ties)} Each match has a reason on its source
                page.
              </p>
              {recall && <Recall text={recall.text} />}
            </Note>
            <Note title="Gaps shown, not hidden" tone="dashed">
              {tradeGaps(m.b).map((g) => (
                <p key={g.id}>{g.text}</p>
              ))}
              <p>
                Lobbying dollars per section are not in the filings: a client reports its total spend across everything
                it lobbied, so this page counts filings, not dollars.
              </p>
            </Note>
          </div>
        </Section>
      )}

      {companies.size > 0 && (
        <Section kicker="How common is this" title="Every tie, beside how common it is">
          <Common
            rate={rate}
            noun={companies.size === 1 ? "this company" : `one of these ${companies.size} companies`}
            window={windowShare(book)}
          />
        </Section>
      )}
    </div>
  );
}

export default function MoneyPage({ route }: { route: Extract<BillRoute, { page: "money" }> }) {
  const m = useModel();
  const v = m.sectionBySlug(route.section);
  const slug = v && m.sectionSlug(v);
  useEffect(() => {
    if (slug && slug !== route.section) navigate(sectionHref(route.id, slug), { replace: true });
  }, [slug, route]);
  if (!v) return <NotFound title="That section is not in this bill." />;
  return <Follow key={v.s.id} v={v} />;
}
