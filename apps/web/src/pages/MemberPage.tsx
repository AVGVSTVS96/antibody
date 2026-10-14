import type { NodeOf } from "@antibody/core";
import { useMemo } from "react";
import { count, usd } from "../lib/format.ts";
import { type BillRoute, billHref, navigate, onLink, sectionHref } from "../lib/router.ts";
import { buildTape } from "../lib/tape.ts";
import { byOwner, medianPerTrader, ownerWords, rankMembers, tradeBook, tradeGaps } from "../lib/trades.ts";
import { Donors } from "../member/Donors.tsx";
import { Months } from "../member/Months.tsx";
import { Seats } from "../member/Seats.tsx";
import { scopeOf } from "../member/scope.ts";
import { Touch } from "../member/Touch.tsx";
import { Trail } from "../member/Trail.tsx";
import { Votes } from "../member/Votes.tsx";
import { lastName, memberName } from "../money/Members.tsx";
import { useModel } from "../ui/BillGate.tsx";
import { NotFound } from "../ui/NotFound.tsx";
import { Kicker, Note, Section, Wrap } from "../ui/primitives.tsx";
import { Src } from "../ui/receipt.tsx";
import { Tape } from "../ui/Tape.tsx";
import "../member/member.css";

function Member({ member }: { member: NodeOf<"member"> }) {
  const m = useModel();
  const book = tradeBook(m);
  const tape = useMemo(() => buildTape(m), [m]);
  const scope = useMemo(() => scopeOf(m), [m]);
  const view = m.memberById.get(member.id)!;
  const last = lastName(member);
  const mine = book.byMember.get(member.id) ?? [];
  const tied = useMemo(() => mine.filter((t) => scope.companies.has(t.company)), [mine, scope]);
  const stocks = new Set(tied.map((t) => t.company));
  const touched = scope.rows.filter((r) => [...(scope.bySection.get(r.id) ?? [])].some((c) => stocks.has(c)));
  const ranked = useMemo(() => rankMembers(m, scope.companies), [m, scope]);
  const gifts = view.funded.reduce((n, f) => n + f.edge.props.amountUsd, 0);
  const owners = byOwner(tied);
  const unread =
    view.node.props.paperFilingsUnread ||
    m.b.gaps.some((g) => g.kind === "paper_filings_unread" && g.nodes.includes(member.id));
  const chamber = member.props.chamber === "House" ? "Representative" : "Senator";
  const seat = member.props.district != null ? `${member.props.state}-${member.props.district}` : member.props.state;
  const bill = m.b.bill.display;
  const bare = scope.kind === "bill";
  const where =
    scope.kind === "quiet"
      ? "the quiet sections"
      : scope.kind === "named"
        ? "the sections lobbyists named"
        : "the bill";

  return (
    <div className="member">
      <Wrap className="page member-head">
        <Kicker>STEP 4 · A MEMBER · SAME PAGE FOR EVERY MEMBER OF EITHER PARTY</Kicker>
        <div className="member-top">
          <div className="member-who">
            <h1>{memberName(member)}</h1>
            <p className="member-tags">
              <b>
                {member.props.party} · {seat}
              </b>
              <span>
                {chamber} · {member.props.chamber}
              </span>
              <Src ids={member.claims} label="Source" />
              {view.sponsor && (
                <>
                  <b className="member-role">Sponsor of {bill}</b>
                  <Src ids={view.sponsor.claims} label="Sponsorship" />
                </>
              )}
              <a href={billHref(m.b.bill.id)} onClick={onLink}>
                The x-ray
              </a>
            </p>
            <p className="lead">
              Shown here only for what the public record ties to {bill}.{" "}
              {tied.length ? (
                <>
                  {count(stocks.size, "company", "companies")} whose lobbyists named {where} appear as trades on {last}
                  's disclosure forms
                  {owners.length === 1 ? `, all in the ${ownerWords(owners[0]!.owner)}` : ""}.
                </>
              ) : (
                <>
                  No trade in a company tied to {where} is on {last}'s disclosure forms in the data.
                </>
              )}{" "}
              {view.funded.length
                ? `The ${view.funded.length === 1 ? "largest tied PAC donor gave" : `${view.funded.length} largest tied PAC donors gave`} ${usd(gifts)}. `
                : ""}
              Whether any of it mattered is not something the record can say.
            </p>
            {view.inserted.length > 0 && (
              <p className="member-ins">
                An amendment of {last}'s that was agreed added or rewrote{" "}
                {view.inserted.map((e, i) => {
                  const v = m.sectionById.get(e.dst.slice(8));
                  return (
                    <span key={e.id}>
                      {i > 0 && ", "}
                      {v ? (
                        <a href={sectionHref(m.b.bill.id, m.sectionSlug(v))} onClick={onLink}>
                          {m.secLabel(v)}
                        </a>
                      ) : (
                        e.dst
                      )}{" "}
                      <Src ids={e.claims} label="Amendment" />
                    </span>
                  );
                })}
                .
              </p>
            )}
          </div>
          <Votes member={member} />
        </div>
      </Wrap>

      <Section
        kicker={
          bare
            ? `${last}'s tape · no section is named in a lobbying filing, so ties are to the bill as a whole`
            : `${last}'s tape · the ${scope.rows.length} ${scope.noun} are tested; the ones tied to stock on ${last}'s forms are lit`
        }
        title={
          bare
            ? `${stocks.size} of the ${scope.companies.size} companies that lobbied ${bill} ${stocks.size === 1 ? "is" : "are"} on ${last}'s forms.`
            : `${touched.length} of the ${scope.rows.length} ${scope.noun} touch stock on ${last}'s forms.`
        }
        aside={
          <p className="kicker member-rule">
            Tie rule: a company lobbied {bare ? "the bill" : "the section"} and its stock is on {last}'s disclosure
            forms. A tie is not proof of anything.
          </p>
        }
      >
        <p className="member-context">
          Context: {last}'s filings list {count(mine.length, "trade")} in{" "}
          {count(new Set(mine.map((t) => t.company)).size, "tied company", "tied companies")}; the median member who
          traded filed {medianPerTrader(book)}.
          {tied.length > 0 &&
            ` The ${stocks.size} ${stocks.size === 1 ? "stock" : "stocks"} below ${stocks.size === 1 ? "is" : "are"} the subset tied to ${where}.`}
        </p>
        <Tape
          tape={tape}
          highlight={bare ? undefined : new Set(touched.map((r) => r.id))}
          legend={false}
          onSelect={(row) => navigate(sectionHref(m.b.bill.id, row.routeId))}
        />
        {touched.length > 0 && (
          <p className="member-lit">
            {touched.map((r) => (
              <a key={r.id} href={sectionHref(m.b.bill.id, r.routeId)} onClick={onLink}>
                {r.label}
              </a>
            ))}
            <span>
              all {scope.kind === "quiet" ? "quiet and costly" : "named in a lobbying filing"}. Each opens the section's
              money.
            </span>
          </p>
        )}
        {unread && (
          <p className="member-unread kicker">
            This member's paper filings have not been read, so some trades may be missing here.
          </p>
        )}
      </Section>

      {tied.length > 0 && (
        <Section
          kicker={`${last}'s trades in those ${stocks.size} stocks · fact · filings`}
          title={`${last}'s trades in ${stocks.size === 1 ? "this stock" : `these ${stocks.size} stocks`}, by date.`}
        >
          <Trail trades={tied} scope={scope} />
        </Section>
      )}

      <Section kicker="Is that a spike? All months, all members" title={`${last}'s trades against every month`}>
        <Months member={member} />
      </Section>

      <Section>
        <div className="member-foot">
          <div>
            <Kicker>PAC money to {last}'s campaign · fact · FEC · a floor, not the total</Kicker>
            <h2>
              {last}'s 5 largest tied PAC donors{view.funded.length ? `: ${usd(gifts)}.` : "."}
            </h2>
            <Donors member={member} />
          </div>
          <div>
            <Kicker>Same lens, everyone · one rule</Kicker>
            <h2>Who else touches {where}?</h2>
            <Touch
              ranked={ranked}
              current={member.id}
              unit={
                bare
                  ? "Tied companies traded"
                  : `Companies tied to ${scope.kind === "quiet" ? "a quiet section" : "a named section"}`
              }
            />
            <p className="kicker">
              {count(ranked.length, "member")} {ranked.length === 1 ? "has" : "have"} at least one. Ordered by how many
              tied companies a member traded, then by name; never by party or dollars. No bar says who acted on what, or
              who knew.
            </p>
          </div>
          <div className="member-says">
            <Note title="What this page does not say">
              That {last} knew a section was coming. That a trade or a donation changed a vote. That a household's stock
              is the member's to decide.{" "}
              {tied.length > 0
                ? `Whose account each trade was in is on the form (${owners.map((o) => `${o.count} in the ${ownerWords(o.owner)}`).join(", ")}); the forms do not say who chose them.`
                : "The forms do not say who chose a trade."}
              {unread && " This member's paper filings are not read yet, so their trades may be incomplete."}
            </Note>
            {tradeGaps(m.b).map((g) => (
              <Note key={g.id} title="Gap shown, not hidden" tone="dashed">
                {g.text}
              </Note>
            ))}
          </div>
        </div>
      </Section>

      <Section kicker={`${last}'s committee seats · fact · roster`} title="Committee seats">
        <Seats member={member} />
      </Section>
    </div>
  );
}

export default function MemberPage({ route }: { route: Extract<BillRoute, { page: "member" }> }) {
  const m = useModel();
  const member = m.memberById.get(`member:${route.bioguide}`);
  if (!member) return <NotFound title="That member is not in this bill's data." />;
  return <Member key={member.node.id} member={member.node} />;
}
