import { type Dollar, headlineDeficit } from "@antibody/core";
import { count, day, musd, nice, RULES_URL } from "../lib/format.ts";
import type { BillModel } from "../lib/model.ts";
import { billHref, onLink } from "../lib/router.ts";
import { Inf, Sources, Src } from "../ui/claims.tsx";

const MEASURE: Record<Dollar["measure"], string> = {
  deficit: "Deficit",
  outlays: "Outlays",
  revenues: "Revenues",
  budget_authority: "Budget authority",
  nonscorable_revenues: "Unscored revenues (not in the deficit)",
};

export function Rules({ m }: { m: BillModel }) {
  const seen = new Set<string>();
  const gaps = m.b.gaps.filter((g) => !seen.has(g.text) && seen.add(g.text));
  return (
    <section className="rules" id="read" aria-label="What’s missing and how to read this page">
      <div className="wrap rules-g">
        <div>
          <h2>What’s missing</h2>
          <ul>
            {gaps.map((g) => (
              <li key={g.id}>
                {g.text} {g.claim && <Src id={g.claim} />}
              </li>
            ))}
            {!gaps.length && <li>Nothing we know of is held out of this page.</li>}
          </ul>
        </div>
        <div>
          <h2>How to read this page</h2>
          <ul className="legendl">
            <li>
              <span className="tag">Fact</span>
              <p>
                Read straight from a public record, with a link to it: congress.gov, GovInfo, CBO, Senate lobbying
                filings, FEC, House and Senate disclosures.
              </p>
            </li>
            <li>
              <span className="tag inf">Inference</span>
              <p>A judgment made by a published rule. It is always dashed and says what it rests on.</p>
            </li>
            <li>
              <span className="tag same">Same rules</span>
              <p>Thresholds, colors and wording are identical for every bill, party and member.</p>
            </li>
          </ul>
          <a className="link iris" href={RULES_URL} target="_blank" rel="noopener">
            Read all {m.b.rules.length || 18} rules
          </a>
        </div>
      </div>
    </section>
  );
}

export function Records({ m }: { m: BillModel }) {
  const { b } = m;
  const lawDeficit = headlineDeficit(b, "current-law");
  const policyDeficit = headlineDeficit(b, "current-policy");
  const est = b.dollars.estimates.find((e) => e.id === lawDeficit?.estimateId) ?? b.dollars.estimates[0];
  const amend = b.amendments;
  const byStatus = (s: string) => amend.filter((a) => a.status === s).length;
  const tied = m.actors.filter((a) => a.benefits).sort((x, y) => nice(x.label).localeCompare(nice(y.label)));
  const withPositions = m.lobbyists.filter((l) => l.props.coveredPositions.length);
  return (
    <section className="wrap records" id="records" aria-labelledby="records-h">
      <h2 id="records-h">The records behind this page</h2>
      <p className="lead narrow">
        Everything above is built from these. Each row links the public record it comes from.{" "}
        <a className="link iris" href={billHref(b.bill.id, { list: true })} onClick={onLink}>
          See every section, with its numbers
        </a>
      </p>
      <div className="rec-g">
        {est && (
          <details>
            <summary>How CBO scored it</summary>
            <p>
              Scored: {est.versionScored}. Baseline: <b>{est.baselineLabel}</b>.{" "}
              {lawDeficit && (
                <>
                  Deficit, {lawDeficit.period}: {musd(lawDeficit.amountMusd)} <Src id={lawDeficit.claim} label="CBO" />.{" "}
                </>
              )}
              {policyDeficit && (
                <>
                  Under current policy: {musd(policyDeficit.amountMusd)} <Src id={policyDeficit.claim} label="CBO" />.{" "}
                </>
              )}
              {b.dollars.wholeBill
                .filter((d) => d.measure !== "deficit" && d.estimateId === est.id)
                .map((d) => (
                  <span key={d.claim}>
                    {MEASURE[d.measure]} {musd(d.amountMusd)} <Src id={d.claim} label="CBO" />{" "}
                  </span>
                ))}
              {est.mandates?.privateSector.startsWith("Yes") && (
                <>
                  CBO says it adds private-sector mandates above the legal threshold{" "}
                  <Src id={est.mandates.claim} label="CBO" />.
                </>
              )}
            </p>
          </details>
        )}
        {b.votes.length > 0 && (
          <details>
            <summary>Roll call votes ({b.votes.length})</summary>
            <ul className="recl">
              {[...b.votes]
                .sort((x, y) => x.date.localeCompare(y.date))
                .map((v) => (
                  <li key={v.id}>
                    <span>
                      <b>
                        {v.chamber}: {v.question}
                      </b>
                      <i>
                        {v.result}, {day(v.date)}
                      </i>
                    </span>
                    <span className="num">
                      {v.yeas}–{v.nays}
                    </span>
                    <Src id={v.claim} />
                  </li>
                ))}
            </ul>
          </details>
        )}
        <details>
          <summary>Text versions ({m.versions.length})</summary>
          <ul className="recl">
            {m.versions.map((v) => (
              <li key={v.code}>
                <span>
                  <b>{v.name}</b>
                  <i>
                    {count(v.sections, "section")}, {v.words.toLocaleString("en-US")} words {v.predecessor && <Inf />}
                  </i>
                </span>
                <span className="num">{day(v.date)}</span>
                <Src id={v.claim} label="text" />
              </li>
            ))}
          </ul>
        </details>
        {amend.length > 0 && (
          <details>
            <summary>Fights outside the text: amendments ({amend.length})</summary>
            <p>
              {byStatus("agreed")} agreed, {byStatus("failed")} failed, {byStatus("withdrawn")} withdrawn,{" "}
              {byStatus("no_action")} with no action recorded on congress.gov.
            </p>
            <ul className="recl">
              {amend.slice(0, 30).map((a) => {
                const sponsor = a.sponsor ? m.memberById.get(a.sponsor)?.node : null;
                return (
                  <li key={a.id}>
                    <span>
                      <b>
                        {a.number}
                        {a.purpose ? `, ${a.purpose}` : ""}
                      </b>
                      <i>
                        {sponsor ? `${sponsor.label}, ` : ""}
                        {a.status.replace("_", " ")}
                        {a.latestActionOn ? `, ${day(a.latestActionOn)}` : ""}
                      </i>
                    </span>
                    <span />
                    <Src id={a.claim} />
                  </li>
                );
              })}
            </ul>
          </details>
        )}
        {tied.length > 0 && (
          <details>
            <summary>
              Companies tied to the bill ({tied.length}) <Inf />
            </summary>
            <p>
              {b.rules.find((r) => r.id === "tied-stock")?.text ??
                "Companies that lobbied on the bill or are named in its text."}{" "}
              A tie is not proof of gain; it is where to look.
            </p>
            <ul className="recl">
              {tied.map((a) => (
                <li key={a.id}>
                  <span>
                    <b>
                      {nice(a.label)} {a.ticker}
                    </b>
                    <i>
                      {a.benefits?.props.rule === "named-in-text"
                        ? "named in the text"
                        : `lobbied: ${count(a.reports, "report")}`}
                      {a.traders.size > 0 && `, ${count(a.traders.size, "member")} traded its stock`}
                    </i>
                  </span>
                  <span />
                  <Sources ids={[...(a.benefits?.claims ?? []), ...a.node.claims]} max={2} />
                </li>
              ))}
            </ul>
          </details>
        )}
        {withPositions.length > 0 && (
          <details>
            <summary>Lobbyists who list a covered position ({withPositions.length})</summary>
            <p>Quoted as each filing wrote it; the position is the filer’s claim and is not checked.</p>
            <ul className="recl">
              {withPositions.map((l) => (
                <li key={l.id}>
                  <span>
                    <b>{l.label}</b>
                    {l.props.coveredPositions.map((p) => (
                      <i key={p.claim}>“{p.quote.length > 160 ? `${p.quote.slice(0, 160)}…` : p.quote}”</i>
                    ))}
                  </span>
                  <span />
                  <Src id={l.props.coveredPositions[0]!.claim} label="LDA" />
                </li>
              ))}
            </ul>
          </details>
        )}
        <details>
          <summary>The rules ({b.rules.length})</summary>
          <ul className="recl">
            {b.rules.map((r) => (
              <li key={r.id}>
                <span>
                  <b>{r.id}</b>
                  <i>{r.text}</i>
                </span>
                <span className="num">v{r.version}</span>
                {r.url ? (
                  <a className="src" href={r.url} target="_blank" rel="noopener">
                    method
                  </a>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </section>
  );
}
