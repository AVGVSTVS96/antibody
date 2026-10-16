import { useState } from "react";
import { PARTY_NAME, pacByParty, phases } from "../lib/derive.ts";
import { count, usd } from "../lib/format.ts";
import type { BillModel } from "../lib/model.ts";
import { ClaimLink, Inf, Sources } from "../ui/claims.tsx";
import { Section } from "./Section.tsx";

export function Money({ m }: { m: BillModel }) {
  const { b } = m;
  const L = b.lobbying;
  const { rows, total } = phases(m);
  const clients = m.actors
    .filter((a) => a.lobbied.length)
    .sort((x, y) => y.reports - x.reports || x.label.localeCompare(y.label));
  const top = clients.slice(0, 6);
  const peak = Math.max(1, ...top.map((a) => a.reports));
  const pac = pacByParty(m);
  const tallest = Math.max(1, ...pac.map((p) => p.got / (p.of || 1)));
  const [all, setAll] = useState(false);
  const moving = rows[0]!;
  const filled = rows.filter((r) => r.n > 0);
  return (
    <Section id="money" title="Who paid to be heard">
      <p className="lead narrow">
        Lobbyists file a report every quarter listing the bills they worked on. {count(L.clients, "client")} named this
        one in {L.reports.toLocaleString("en-US")} reports.{" "}
        {total > 0 && rows[2]!.pct >= 60 && b.bill.law
          ? "Almost all of those reports came after it was signed, when agencies were writing the rules."
          : total > 0 && moving.pct >= 60
            ? "Most of those reports were filed while the bill was moving."
            : ""}
      </p>
      {total > 0 && (
        <div className="timing">
          <div className="timing-h">
            <b>When the {L.reports.toLocaleString("en-US")} reports were filed</b>
            <span>While the bill was moving: {moving.n.toLocaleString("en-US")}</span>
          </div>
          <div
            className="timing-bar"
            role="img"
            aria-label={filled.map((r) => `${r.pct}% ${r.title.toLowerCase()}`).join(", ")}
          >
            {filled.map((r) => (
              <div key={r.key} className={`seg ${r.key}`} style={{ flexGrow: r.n }}>
                <span className="num">{r.pct < 1 ? "<1" : r.pct}%</span>
              </div>
            ))}
          </div>
          <ul className="timing-key">
            {rows.map((r) => (
              <li key={r.key} className={`k-${r.key}${r.n ? "" : " none"}`} style={{ flexGrow: r.n, flexBasis: 0 }}>
                <i className={`sw ${r.key}`} />
                <b>{r.title}</b>
                <span className="num">
                  {r.n.toLocaleString("en-US")}
                  <em>
                    {r.n ? " reports" : ""}
                    {r.note ? `, ${r.note}` : ""}
                  </em>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="money-g">
        <div className="clients">
          <header>
            <h3>Most reports naming the bill</h3>
            <span>Reports</span>
          </header>
          {top.length ? (
            <ul>
              {top.map((a) => (
                <li key={a.id}>
                  <ClaimLink id={a.lobbied[0]?.claims[0]} className="cname">
                    {a.short}
                  </ClaimLink>
                  <span className="bar" aria-hidden="true">
                    <i style={{ width: `${(a.reports / peak) * 100}%` }} />
                  </span>
                  <b className="num">{a.reports.toLocaleString("en-US")}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">No lobbying reports name this bill.</p>
          )}
          <footer>
            {clients.length > 6 ? (
              <button
                type="button"
                className="link money"
                aria-expanded={all}
                onClick={() => {
                  setAll((v) => !v);
                  requestAnimationFrame(() =>
                    document.getElementById("all-clients")?.scrollIntoView({ block: "nearest" }),
                  );
                }}
              >
                {all ? "Hide the list" : `The ${clients.length.toLocaleString("en-US")} clients listed here`}
              </button>
            ) : (
              <span />
            )}
            <span>
              Source: <Sources ids={L.claims} max={1} />
            </span>
          </footer>
        </div>
        <div className="pac">
          <header>
            <h3>PAC money before the vote</h3>
            <Inf />
          </header>
          {pac.some((p) => p.usd > 0) ? (
            <>
              <p>
                Political action committees of companies tied to the bill gave to{" "}
                {pac.every((p) => p.got / (p.of || 1) > 0.6) ? "almost every" : "many a"} member who voted on it
                {pac.length > 1 ? ", on both sides" : ""}. Party is a label here, never a color.
              </p>
              <ul>
                {pac.map((p) => (
                  <li key={p.party}>
                    <div>
                      <b>{PARTY_NAME[p.party]}</b>
                      <span className="num pac-full">
                        {usd(p.usd)} to {p.got} of {p.of}
                        {p.got > 0 ? `, about ${usd(p.usd / p.got)} each` : ""}
                      </span>
                      <span className="num pac-short">
                        {p.got} of {p.of}
                      </span>
                    </div>
                    <span className="meter">
                      <i style={{ width: `${(p.got / (p.of || 1) / tallest) * 100}%` }} />
                    </span>
                    <span className="pac-sub num">
                      {usd(p.usd)} in all{p.got > 0 ? `, about ${usd(p.usd / p.got)} each` : ""}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="fine">
                Bars show the share of each group that got money. Only each member’s five largest tied givers are
                counted, so the totals are a floor. Source: FEC filings.
              </p>
            </>
          ) : (
            <p className="empty">No PAC money from companies tied to this bill was found in the filings we read.</p>
          )}
        </div>
      </div>
      {clients.length > 6 && all && (
        <div className="all" id="all-clients">
          <p className="fine">
            The {clients.length.toLocaleString("en-US")} clients with the most reports naming this bill, out of{" "}
            {L.clients.toLocaleString("en-US")} in all, plus every client that resolves to a public company.
          </p>
          <ul className="allclients">
            {clients.map((a) => (
              <li key={a.id}>
                <ClaimLink id={a.lobbied[0]?.claims[0]} className="cname">
                  {a.short}
                </ClaimLink>
                <span className="num">{count(a.reports, "report")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}
