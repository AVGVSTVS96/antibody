import { type Dollar, headlineDeficit } from "@antibody/core";
import { useState } from "react";
import { count, day, deficitWords, musd, nice, RULES_URL, rank, usd } from "../lib/format.ts";
import type { Actor, BillModel, MemberView, SectionView } from "../lib/model.ts";
import { Inf, Sources, Src } from "../ui/claims.tsx";
import { useRowFocus } from "./focus.ts";

const MEASURE = {
  deficit: "Deficit",
  outlays: "Outlays",
  revenues: "Revenues",
  budget_authority: "Budget authority",
  nonscorable_revenues: "Unscored revenues (not in the deficit)",
};

export const secId = (v: SectionView) => `section:${v.s.id}`;

const jump = (id: string) => () => {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
};

/** What makes a section's stakes big, in words: its CBO figure and its lobbying reports. */
function stakesWords(v: SectionView): string {
  const bits = [
    v.dollarsMusd != null && v.s.score?.components.dollarsSplit !== "even_split" ? deficitWords(v.dollarsMusd) : null,
    v.lobbied ? `${count(v.lobbied, "lobbying report")} name it` : null,
  ].filter(Boolean);
  return bits.join(" and ");
}

/** The section closest to the buried rule that did not meet it, so "none" never reads as "not measured". */
function closest(m: BillModel): SectionView | undefined {
  return m.sections
    .filter((v) => v.s.inFinal && v.kind !== "buried" && v.kind !== "headline" && v.s.score?.buried != null)
    .sort((x, y) => y.s.score!.buried! - x.s.score!.buried!)[0];
}

/** The ten-second read: the loud fight, what is quiet with big stakes, and the money, each with one number and a jump link. */
export function Story({ m }: { m: BillModel }) {
  const loud = m.headline[0];
  const quiet = m.buried[0];
  const near = closest(m);
  const A = m.b.attention;
  const ranked = m.sections.some((v) => v.s.attention?.pct != null);
  const companies = m.actors.filter((a) => a.lobbied.length).length;
  return (
    <div className="story">
      <div className="beat">
        <i>The loud part</i>
        {loud ? (
          <p>
            <b>
              {m.secLabel(loud)} {loud.s.heading}
            </b>{" "}
            got the most news: {count(loud.s.attention?.hits ?? 0, "article")}
            {A.sample ? ` of the ${A.sample.relevant.toLocaleString("en-US")} read` : ""}.
          </p>
        ) : (
          <p>No section stands out in the news{ranked ? "." : ": too few articles to rank this bill’s sections."}</p>
        )}
        <button type="button" className="linkbtn" onClick={jump("card-headline")}>
          See the loud sections
        </button>
      </div>
      <div className="beat">
        <i>The quiet part</i>
        {quiet ? (
          <p>
            <b>
              {m.secLabel(quiet)} {quiet.s.heading}
            </b>{" "}
            has big stakes ({stakesWords(quiet)}) and {count(quiet.s.attention?.hits ?? 0, "news article")}
            {quiet.s.late ? ", and it was added late" : ""}.
          </p>
        ) : !ranked ? (
          <p>Not tested: there are too few news articles to say which sections are quiet.</p>
        ) : (
          <p>
            No section was both big-stakes, added late or off-topic, and ignored by the news.
            {near && (
              <>
                {" "}
                The closest is{" "}
                <b
                  title={`Scored ${near.s.score!.buried!.toFixed(2)}; the bar is 0.45. ${stakesWords(near) || "No big stakes"}.`}
                >
                  {m.secLabel(near)} {near.s.heading}
                </b>
                .{" "}
                <a href={`${RULES_URL}#buried-v1`} target="_blank" rel="noopener">
                  The rule
                </a>
              </>
            )}
          </p>
        )}
        <button type="button" className="linkbtn" onClick={jump("card-buried")}>
          See the quiet sections
        </button>
      </div>
      <div className="beat">
        <i>The money</i>
        <p>
          <b>{count(companies, "company", "companies")}</b> lobbied on it. <b>{m.tradersDuring}</b> of 535 members
          traded stock in a tied company while the bill moved. Routine disclosures; no link to any vote is claimed.
        </p>
        <button type="button" className="linkbtn" onClick={jump("card-lobby")}>
          See who lobbied
        </button>
      </div>
    </div>
  );
}

export function BillCard({ m }: { m: BillModel }) {
  const { b } = m;
  const lawDeficit = headlineDeficit(b, "current-law");
  const policyDeficit = headlineDeficit(b, "current-policy");
  const est = b.dollars.estimates.find((e) => e.id === lawDeficit?.estimateId) ?? b.dollars.estimates[0];
  const amend = b.amendments;
  const byStatus = (s: string) => amend.filter((a) => a.status === s).length;
  return (
    <div className="card" id="card-bill">
      <div className="cap">
        Bill{b.bill.law ? ` · ${b.bill.law}` : ""}
        {b.bill.lawOn ? ` · signed ${day(b.bill.lawOn)}` : ""}
      </div>
      <h2 style={{ marginTop: 6 }}>
        {b.bill.shortTitle ?? b.bill.title}
        <span className="mono muted" style={{ fontSize: 13, fontWeight: 500 }}>
          {b.bill.display}
        </span>
      </h2>
      <p className="sub">
        {b.bill.shortTitle ? `${b.bill.title.replace(/\.+$/, "")}. ` : ""}
        {m.sponsor &&
          (b.bill.vehicle ? (
            <>
              Vehicle bill introduced by {m.sponsor.label}. {b.bill.vehicle}{" "}
            </>
          ) : (
            <>Sponsor {m.sponsor.label}. </>
          ))}
        {b.bill.claims.length ? (
          <Sources ids={b.bill.claims} />
        ) : (
          <a className="src" href={b.bill.billstatusUrl} target="_blank" rel="noopener">
            BILLSTATUS
          </a>
        )}
      </p>
      <div className="stats">
        <div className="stat">
          <div className="k">{lawDeficit ? `Deficit, ${lawDeficit.period}` : "Deficit"}</div>
          {lawDeficit ? (
            <>
              <div className="v">{musd(lawDeficit.amountMusd)}</div>
              <div className="n">
                {lawDeficit.baseline === "current-law" ? "current law" : "current policy"}{" "}
                <Src id={lawDeficit.claim} label="CBO" />
              </div>
            </>
          ) : (
            <>
              <div className="v missing">No CBO score</div>
              <div className="n">none published</div>
            </>
          )}
        </div>
        <div className="stat">
          <div className="k">Lobbying</div>
          <div className="v">{b.lobbying.reports.toLocaleString("en-US")}</div>
          <div className="n">reports from {count(b.lobbying.clients, "client")}</div>
        </div>
        <div className="stat">
          <div className="k">Traded tied stock</div>
          <div className="v">{m.tradersDuring}</div>
          <div className="n">of 535 members, first text to signing</div>
        </div>
        <div className="stat">
          <div className="k">Added late</div>
          {m.lateShare == null ? (
            <>
              <div className="v missing">Unknown</div>
              <div className="n">shell or rewritten bill</div>
            </>
          ) : (
            <>
              <div className="v">{m.sections.filter((v) => v.s.inFinal && v.s.late).length}</div>
              <div className="n">of {count(m.sections.filter((v) => v.s.inFinal).length, "section")}</div>
            </>
          )}
        </div>
      </div>
      {est && (
        <div className="row-meta" style={{ marginTop: 6 }}>
          Scored: {est.versionScored}. Baseline: <b>{est.baselineLabel}</b>.{" "}
          {policyDeficit && (
            <span>
              Under current policy: {musd(policyDeficit.amountMusd)} <Src id={policyDeficit.claim} label="CBO" />{" "}
            </span>
          )}
          {b.dollars.wholeBill
            .filter((d) => d.measure !== "deficit" && d.baseline === est.baseline)
            .map((d: Dollar) => (
              <span key={d.claim}>
                {MEASURE[d.measure]} {musd(d.amountMusd)} <Src id={d.claim} label="CBO" />{" "}
              </span>
            ))}
          {est.mandates?.privateSector.startsWith("Yes") && (
            <span>
              CBO says it adds private-sector mandates above the legal threshold{" "}
              <Src id={est.mandates.claim} label="CBO" />.
            </span>
          )}
        </div>
      )}
      {b.votes.length > 0 && (
        <details>
          <summary>Roll call votes ({b.votes.length})</summary>
          <ul className="rows">
            {[...b.votes]
              .sort((x, y) => x.date.localeCompare(y.date))
              .map((v) => (
                <li key={v.id}>
                  <div className="row-top">
                    <span className="t" style={{ fontWeight: 500 }}>
                      {v.chamber}: {v.question}
                    </span>
                    <span className="num">
                      {v.yeas}-{v.nays}
                    </span>
                  </div>
                  <div className="row-meta">
                    {v.result} · {day(v.date)} <Src id={v.claim} />
                  </div>
                </li>
              ))}
          </ul>
        </details>
      )}
      <details>
        <summary>Version timeline ({m.versions.length})</summary>
        <ul className="rows">
          {m.versions.map((v) => (
            <li key={v.code}>
              <div className="row-top">
                <span className="t" style={{ fontWeight: 500 }}>
                  {v.name}
                </span>
                <span className="num">{day(v.date)}</span>
              </div>
              <div className="row-meta">
                {count(v.sections, "section")} · {v.words.toLocaleString("en-US")} words {v.predecessor && <Inf />}{" "}
                <Src id={v.claim} />
              </div>
            </li>
          ))}
        </ul>
      </details>
      {amend.length > 0 && (
        <details>
          <summary>Fights outside the text: amendments ({amend.length})</summary>
          <div className="split">
            <span>{byStatus("agreed")} agreed</span>
            <span>{byStatus("failed")} failed</span>
            <span>{byStatus("withdrawn")} withdrawn</span>
            <span>{byStatus("no_action")} none recorded on congress.gov</span>
          </div>
          <ul className="rows">
            {amend.slice(0, 30).map((a) => {
              const sponsor = a.sponsor ? m.memberById.get(a.sponsor)?.node : null;
              return (
                <li key={a.id}>
                  <div className="row-top">
                    <span className="t" style={{ fontWeight: 500 }}>
                      {a.number} {a.purpose ? `· ${a.purpose}` : ""}
                    </span>
                    <span className="num">{a.status.replace("_", " ")}</span>
                  </div>
                  <div className="row-meta">
                    {sponsor ? `${sponsor.label} · ` : ""}
                    {a.latestActionOn ? day(a.latestActionOn) : ""} <Src id={a.claim} />
                  </div>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}

function Gap({ m, kind }: { m: BillModel; kind: BillModel["b"]["gaps"][number]["kind"] }) {
  const gaps = m.b.gaps.filter((g) => g.kind === kind);
  return gaps.map((g) => (
    <div className="warn" key={g.id}>
      <span>
        {g.text} {g.claim && <Src id={g.claim} />}
      </span>
    </div>
  ));
}

const groups = ["left", "center-left", "center", "center-right", "right"] as const;
const OUTLETS_URL = "https://github.com/AVGVSTVS96/antibody/blob/main/packages/ingest-news/data/outlets.json";

function AttentionSplit({ a }: { a: NonNullable<SectionView["s"]["attention"]> }) {
  const parts = groups.filter((g) => a.hitsByGroup[g]);
  if (!parts.length && !a.tradeLegalHits) return null;
  return (
    <div className="subs">
      {parts.map((g) => (
        <span key={g}>
          {g} <b>{a.hitsByGroup[g]}</b>
        </span>
      ))}
      {a.tradeLegalHits > 0 && (
        <span>
          trade/legal <b>{a.tradeLegalHits}</b>
        </span>
      )}
    </div>
  );
}

function HeadlineRow({ v, m }: { v: SectionView; m: BillModel }) {
  const row = useRowFocus();
  return (
    <li {...row(secId(v))}>
      <div className="row-top">
        <span className="t">
          {m.secLabel(v)} {v.s.heading}
        </span>
        <span className="num" title="0 to 100; 100 is the most-covered section of this bill">
          loudness {rank(v.s.attention?.pct)}
        </span>
      </div>
      <div className="bar">
        <i style={{ width: `${(v.s.attention?.pct ?? 0) * 100}%` }} />
      </div>
      <div className="row-meta">{count(v.s.attention?.hits ?? 0, "article")} matched this section</div>
      {v.s.attention && <AttentionSplit a={v.s.attention} />}
      <Sources ids={[v.s.attention?.claim, ...(v.s.attention?.examples.map((e) => e.claim) ?? []), v.s.claims[0]]} />
    </li>
  );
}

const SHOWN = 5;

export function HeadlineCard({ m }: { m: BillModel }) {
  const row = useRowFocus();
  const A = m.b.attention;
  const scored = m.sections.filter((v) => v.s.attention?.pct != null).length;
  const via =
    A.via.map((v) => (v === "mediacloud" ? "Media Cloud" : "Google News")).join(" + ") || "no news source yet";
  return (
    <div className="card" id="card-headline">
      <h2>Headline</h2>
      <p className="sub">
        {scored
          ? `The sections with the most news attention, out of ${scored} ranked`
          : "Too few articles to rank sections; only raw counts are shown"}
        ,{" "}
        {A.sample
          ? `from ${A.sample.relevant.toLocaleString("en-US")} relevant articles read, out of ${A.sample.found.toLocaleString("en-US")} found`
          : `from ${count(A.articles, "article")}`}{" "}
        via {via}
        {A.outletListVersion ? (
          <>
            ,{" "}
            <a href={OUTLETS_URL} target="_blank" rel="noopener">
              outlet list {A.outletListVersion}
            </a>
          </>
        ) : null}
        {A.window ? ` (${day(A.window[0])} to ${day(A.window[1])})` : ""}. Loudness runs 0 to 100; 100 is the most
        covered section of this bill. Headline means the top tenth of this bill’s sections by loudness, with at least 3
        matching articles, so it is relative to this bill (
        <a href={`${RULES_URL}#attention-v1`} target="_blank" rel="noopener">
          how attention is counted
        </a>
        ).
      </p>
      <Gap m={m} kind="attention_partial" />
      <ul className="rows">
        {m.headline.slice(0, SHOWN).map((v) => (
          <HeadlineRow key={v.s.id} v={v} m={m} />
        ))}
        {!m.headline.length && (
          <li>
            <span className="miss">No section clears the headline bar on this bill.</span>
          </li>
        )}
      </ul>
      {m.headline.length > SHOWN && (
        <details>
          <summary>Show all {m.headline.length} headline sections</summary>
          <ul className="rows">
            {m.headline.slice(SHOWN).map((v) => (
              <HeadlineRow key={v.s.id} v={v} m={m} />
            ))}
          </ul>
        </details>
      )}
      {A.general && (
        <ul className="rows">
          <li {...row(m.billNode)}>
            <div className="row-top">
              <span className="t">The bill as a whole</span>
              <span className="num">{count(A.general.hits, "article")}</span>
            </div>
            <div className="row-meta">
              News that matched no single section better than the bill in general: often the loudest fight is about
              something that isn’t in the text.
            </div>
            <AttentionSplit a={A.general} />
            <Sources ids={[A.general.claim, ...A.general.examples.map((e) => e.claim)]} />
          </li>
        </ul>
      )}
    </div>
  );
}

function SectionFacts({ m, v }: { m: BillModel; v: SectionView }) {
  const inserted = m.edges.filter((e) => e.kind === "inserted" && e.dst === secId(v));
  const sc = v.s.score;
  const c = sc?.components;
  return (
    <>
      <div className="row-meta">
        <b>Fact:</b> first appears in {v.stageName}
        {v.s.splitFrom ? ", split out of an older section" : ""}. <Src id={v.s.claims[0]!} />
      </div>
      {inserted.map((e) => {
        const who = m.memberById.get(e.src)?.node;
        return (
          <div className="row-meta" key={e.id}>
            Came in through {who?.label ?? "an amendment"}’s amendment. {e.inference && <Inf />}{" "}
            <Sources ids={e.claims} />
          </div>
        );
      })}
      {c && (
        <div className="subs">
          <span>
            <b>{c.attentionPct == null ? "not ranked" : count(v.s.attention?.hits ?? 0, "news article")}</b>
            {c.attentionPct != null && ` (loudness ${rank(c.attentionPct)} of 100)`}
          </span>
          <span>
            <b>{m.b.bill.lateUnavailable ? "late: unknown" : c.late ? "added late" : "not added late"}</b>
          </span>
          <span>
            <b>{c.dollarsMusd == null ? "no CBO figure" : deficitWords(c.dollarsMusd)}</b>
            {c.dollarsSplit === "even_split" ? " (even split, not counted)" : ""}
          </span>
          <span>
            <b>{count(c.lobbyingReports, "lobbying report")}</b>
          </span>
          {c.offTopic != null && (
            <span>
              <b>unlike the rest of the bill: {rank(c.offTopic)} of 100</b>
            </span>
          )}
        </div>
      )}
    </>
  );
}

/** One plain sentence built from the section's own numbers, so the legal text can wait behind a toggle. */
function plainLine(v: SectionView): string {
  const c = v.s.score?.components;
  const stakes = stakesWords(v);
  const news = `${count(v.s.attention?.hits ?? 0, "news article")} matched it`;
  return `${stakes ? `${stakes[0]!.toUpperCase()}${stakes.slice(1)}` : "Big stakes"}, and ${news}${c?.late ? "; it was added after a chamber had passed the bill" : ""}.`;
}

function BuriedRow({ v, m }: { v: SectionView; m: BillModel }) {
  const row = useRowFocus();
  return (
    <li {...row(secId(v))}>
      <div className="row-top">
        <span className="t">
          {m.secLabel(v)} {v.s.heading}
        </span>
        <span className="pill buried">{v.s.late ? "late + quiet" : "quiet + money"}</span>
      </div>
      <div className="plain">{plainLine(v)}</div>
      <details className="legal">
        <summary>Show the legal text</summary>
        <div className="quote">{v.s.preview}…</div>
      </details>
      <SectionFacts m={m} v={v} />
      <Sources ids={[v.s.score?.claim, v.s.attention?.claim, ...v.s.dollars.map((d) => d.claim)]} />
    </li>
  );
}

export function BuriedCard({ m }: { m: BillModel }) {
  const row = useRowFocus();
  const rule = m.b.rules.find((r) => r.id === "buried-v1");
  const lateUnknown = m.b.bill.lateUnavailable;
  const late = lateUnknown ? [] : m.sections.filter((v) => v.s.inFinal && v.s.late && v.kind !== "buried");
  const removed = m.sections.filter((v) => !v.s.inFinal);
  const ranked = m.sections.some((v) => v.s.attention?.pct != null);
  const lateOff = m.lateShare != null && m.lateShare >= 0.5;
  return (
    <div className="card" id="card-buried">
      <h2>
        Buried candidates <Inf />
      </h2>
      <p className="sub">
        Sections with big stakes (a CBO figure of $10 billion or more, or about 20 lobbying reports), little news, and
        either added late or unlike the rest of the bill. A place to look, not a verdict.{" "}
        {rule?.url && (
          <a className="src" href={rule.url} target="_blank" rel="noopener">
            full rule
          </a>
        )}{" "}
        Lateness comes from the text versions (a fact); quietness from a sample of news articles, and a model decides
        which section an article is about (two models agree on that about a quarter of the time), so “no articles” is a
        lead, not proof.
      </p>
      {m.lateShare != null && (
        <div className={lateOff ? "warn" : "row-meta"}>
          <span>
            {Math.round(m.lateShare * 100)}% of this bill’s sections arrived late.{" "}
            {lateOff
              ? "Late is not counted as a signal once half the bill or more arrived late, so no section here is flagged for being late."
              : "Late is not counted as a signal above 50%."}
          </span>
        </div>
      )}
      {lateUnknown && (
        <div className="warn">
          <span>Late flag unavailable: {lateUnknown}</span>
        </div>
      )}
      {!ranked && (
        <div className="warn">
          <span>
            Not tested: there are too few news articles to say which sections are quiet, so nothing here can be called a
            buried candidate.
          </span>
        </div>
      )}
      <ul className="rows">
        {m.buried.slice(0, SHOWN).map((v) => (
          <BuriedRow key={v.s.id} v={v} m={m} />
        ))}
        {!m.buried.length && ranked && (
          <li>
            <span className="miss">No section meets the buried-candidate rule on this bill.</span>
          </li>
        )}
      </ul>
      {m.buried.length > SHOWN && (
        <details>
          <summary>Show all {m.buried.length} buried candidates</summary>
          <ul className="rows">
            {m.buried.slice(SHOWN).map((v) => (
              <BuriedRow key={v.s.id} v={v} m={m} />
            ))}
          </ul>
        </details>
      )}
      {late.length > 0 && (
        <details>
          <summary>Added late but not quiet ({late.length})</summary>
          <ul className="rows">
            {late.map((v) => (
              <li key={v.s.id} {...row(secId(v))}>
                <div className="row-top">
                  <span className="t" style={{ fontWeight: 500 }}>
                    {m.secLabel(v)} {v.s.heading}
                  </span>
                  <span className="num">loudness {rank(v.s.attention?.pct)}</span>
                </div>
                <div className="row-meta">
                  first in {v.stageName} <Src id={v.s.claims[0]!} />
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
      {m.quiet.length > 0 && (
        <details>
          <summary>
            Quiet {lateUnknown ? "" : "but not late "}({m.quiet.length})
          </summary>
          <ul className="rows">
            {m.quiet.map((v) => (
              <li key={v.s.id} {...row(secId(v))}>
                <div className="row-top">
                  <span className="t" style={{ fontWeight: 500 }}>
                    {m.secLabel(v)} {v.s.heading}
                  </span>
                  <span className="num">loudness {rank(v.s.attention?.pct)}</span>
                </div>
                <Sources ids={[v.s.attention?.claim, v.s.claims[0]]} />
              </li>
            ))}
          </ul>
        </details>
      )}
      {removed.length > 0 && (
        <details>
          <summary>Dropped before the final text ({removed.length})</summary>
          <ul className="rows">
            {removed.map((v) => (
              <li key={v.s.id} {...row(secId(v))}>
                <div className="row-top">
                  <span className="t" style={{ fontWeight: 500 }}>
                    {m.secLabel(v)} {v.s.heading}
                  </span>
                  <span className="pill removed">
                    {v.s.mergedInto ? "merged" : v.s.splitInto.length ? "split" : "dropped"}
                  </span>
                </div>
                <div className="row-meta">
                  in {v.stageName}, gone in {m.versions.find((x) => x.code === v.s.removedIn)?.name ?? v.s.removedIn}{" "}
                  <Src id={v.s.claims[0]!} />
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ActorRow({ a, m }: { a: Actor; m: BillModel }) {
  const row = useRowFocus();
  const res = a.resolutions.find((r) => r.src.startsWith("client:"));
  const filedAs = res ? m.b.nodes.find((n) => n.id === res.src)?.label : null;
  return (
    <li {...row(a.id)}>
      <div className="row-top">
        <span className="t">
          {nice(a.label)} {a.ticker && <span className="tk">{a.ticker}</span>}
        </span>
        <span className="num">{count(a.reports, "report")}</span>
      </div>
      <div className="row-meta">
        {a.kind === "company" ? (
          filedAs && nice(filedAs) !== nice(a.label) ? (
            <>
              filed as “{nice(filedAs)}” <Inf />
            </>
          ) : (
            "public company"
          )
        ) : (
          "no public parent company"
        )}
        {a.spendUsd != null && <> · {usd(a.spendUsd)} total in those quarters, for all the issues the filings list</>}
      </div>
      <Sources ids={a.lobbied.flatMap((e) => e.claims).concat(res?.claims ?? [])} />
    </li>
  );
}

export function LobbyCard({ m }: { m: BillModel }) {
  const L = m.b.lobbying;
  const lobbied = m.actors.filter((a) => a.lobbied.length).sort((x, y) => y.reports - x.reports);
  const withPositions = m.lobbyists.filter((l) => l.props.coveredPositions.length);
  const total = L.byPhase.bill + L.byPhase.enactmentQuarter + L.byPhase.law || 1;
  const pct = (n: number) => Math.round((n / total) * 100);
  return (
    <div className="card" id="card-lobby">
      <h2>Who lobbied</h2>
      <p className="sub">LD-2 lobbying reports that name the bill. Each client links to a filing.</p>
      <div className="stats">
        <div className="stat">
          <div className="k">Reports</div>
          <div className="v">{L.reports.toLocaleString("en-US")}</div>
          <div className="n">naming the bill</div>
        </div>
        <div className="stat">
          <div className="k">Clients</div>
          <div className="v">{L.clients}</div>
          <div className="n">
            {L.lobbyists} lobbyists, {L.registrants} firms
          </div>
        </div>
        <div className="stat">
          <div className="k">Spend in those filings</div>
          <div className="v">{usd(L.spendTotalUsd)}</div>
          <div className="n">all issues, not this bill alone</div>
        </div>
      </div>
      <div className="row-meta" style={{ margin: "6px 0 2px" }}>
        An LD-2 report gives one total for every issue it lists, and one issue line often names dozens of bills, so no
        dollar figure is given for this bill alone: the total is the fact. <Sources ids={L.claims} />
      </div>
      <div className="split" role="img" aria-label="When the reports were filed">
        <span>{pct(L.byPhase.bill)}% of reports were filed while the bill was moving</span>
        <span>{pct(L.byPhase.enactmentQuarter)}% in the quarter it was signed</span>
        <span>{pct(L.byPhase.law)}% after it became law</span>
      </div>
      <ul className="rows">
        {lobbied.slice(0, 8).map((a) => (
          <ActorRow key={a.id} a={a} m={m} />
        ))}
      </ul>
      {lobbied.length > 8 && (
        <details>
          <summary>All {lobbied.length} clients on the map</summary>
          <ul className="rows">
            {lobbied.slice(8).map((a) => (
              <ActorRow key={a.id} a={a} m={m} />
            ))}
          </ul>
        </details>
      )}
      {withPositions.length > 0 && (
        <details>
          <summary>Lobbyists who list a covered position ({withPositions.length})</summary>
          <p className="row-meta">
            Quoted as each filing wrote it; the position is the filer’s claim and is not checked.
          </p>
          <ul className="rows">
            {withPositions.map((l) => (
              <li key={l.id}>
                <div className="row-top">
                  <span className="t" style={{ fontWeight: 500 }}>
                    {l.label}
                  </span>
                </div>
                {l.props.coveredPositions.map((p) => (
                  <div className="quote" key={p.claim}>
                    “{p.quote.length > 160 ? `${p.quote.slice(0, 160)}…` : p.quote}” <Src id={p.claim} label="LDA" />
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function BenefitsCard({ m }: { m: BillModel }) {
  const row = useRowFocus();
  const rule = m.b.rules.find((r) => r.id === "tied-stock");
  const tied = m.actors.filter((a) => a.benefits).sort((x, y) => nice(x.label).localeCompare(nice(y.label)));
  return (
    <div className="card">
      <h2>
        Companies tied to the bill <Inf />
      </h2>
      <p className="sub">
        {rule ? rule.text : "Companies that lobbied on the bill or are named in its text."} A tie is not proof of gain;
        it is where to look. Listed alphabetically.
      </p>
      <Gap m={m} kind="entity_recall" />
      <ul className="rows">
        {tied.slice(0, 10).map((a) => (
          <li key={a.id} {...row(a.id)}>
            <div className="row-top">
              <span className="t">
                {nice(a.label)} {a.ticker && <span className="tk">{a.ticker}</span>}
              </span>
              <span className="num">{a.traders.size ? count(a.traders.size, "member") : ""}</span>
            </div>
            <div className="row-meta">
              {a.benefits?.props.rule === "named-in-text"
                ? "named in the text"
                : `lobbied: ${count(a.reports, "report")}`}
              {a.traders.size > 0 && <> · {count(a.traders.size, "member")} traded its stock</>}
              {a.pacUsd > 0 && <> · its PAC gave {usd(a.pacUsd)}</>}
            </div>
            <Sources ids={[...(a.benefits?.claims ?? []), ...a.node.claims]} />
          </li>
        ))}
      </ul>
      {tied.length > 10 && (
        <details>
          <summary>All {tied.length} tied companies</summary>
          <ul className="rows">
            {tied.slice(10).map((a) => (
              <li key={a.id} {...row(a.id)}>
                <div className="row-top">
                  <span className="t" style={{ fontWeight: 500 }}>
                    {nice(a.label)} {a.ticker && <span className="tk">{a.ticker}</span>}
                  </span>
                  <span className="num">{a.traders.size || ""}</span>
                </div>
                <Sources ids={[...(a.benefits?.claims ?? []), ...a.node.claims]} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const OWNER_WORD = { self: "own", spouse: "spouse", joint: "joint", dependent: "child" } as const;

function tradeTiming(v: MemberView, voteOn: string | undefined) {
  if (!voteOn) return null;
  const dates = v.trades.flatMap((t) => t.props.events.map((e) => e.date));
  const before = dates.filter((d) => d <= voteOn).length;
  return `${count(before, "trade")} dated on or before the vote date, ${dates.length - before} after`;
}

const tradesBefore = (v: MemberView, voteOn: string | undefined) =>
  voteOn ? v.trades.flatMap((t) => t.props.events).filter((e) => e.date <= voteOn).length : 0;

const lastName = (v: MemberView) => {
  const n = v.node.label.replace(/^(Sen|Rep)\.\s+/, "").replace(/\s*\(.*\)$/, "");
  return (
    n
      .split(" ")
      .filter((w) => !/^(Jr|Sr|II|III)\.?$/.test(w))
      .at(-1) ?? n
  );
};

function MemberRow({ v, m }: { v: MemberView; m: BillModel }) {
  const row = useRowFocus();
  const p = v.node.props;
  const tickers = new Map<string, number>();
  const owners = new Map<string, number>();
  for (const t of v.trades)
    for (const e of t.props.events) {
      tickers.set(e.ticker ?? e.asset, (tickers.get(e.ticker ?? e.asset) ?? 0) + 1);
      owners.set(e.owner, (owners.get(e.owner) ?? 0) + 1);
    }
  const tk = [...tickers].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const roll = v.vote ? m.b.votes.find((r) => r.id === v.vote!.props.rollId) : null;
  const differs = v.trades.flatMap((t) => t.props.events).filter((e) => e.nameMatch === false).length;
  const timing = tradeTiming(v, roll?.date);
  return (
    <li {...row(v.node.id)}>
      <div className="row-top">
        <span className="t">
          {v.node.label.replace(/\s*\(.*\)$/, "")}{" "}
          <span className="tk">
            {p.party}-{p.state}
            {p.district ? `-${p.district}` : ""} · {p.chamber}
          </span>
        </span>
        <span className="num">{count(v.tradeCount, "trade")}</span>
      </div>
      <div className="row-meta">
        <span className="mono">{tk.map(([t, n]) => `${t}×${n}`).join(" ")}</span>
        {" · "}
        {[...owners].map(([o, n]) => `${OWNER_WORD[o as keyof typeof OWNER_WORD]} ${n}`).join(", ")}
        {v.vote && roll && (
          <>
            {" "}
            · voted <b>{v.vote.props.vote}</b>
          </>
        )}
        {v.sponsor && " · sponsor"}
        {p.paperFilingsUnread && " · has unread paper filings"}
      </div>
      {(timing || differs > 0) && (
        <div className="row-meta">
          {timing}
          {timing && differs > 0 && " · "}
          {differs > 0 &&
            `${count(differs, "report")} name${differs === 1 ? "s" : ""} the company differently than the SEC does`}
        </div>
      )}
      <Sources ids={[...v.trades.flatMap((t) => t.claims), ...(v.vote?.claims ?? [])]} max={4} />
    </li>
  );
}

export function MembersCard({ m }: { m: BillModel }) {
  const row = useRowFocus();
  const [az, setAz] = useState(false);
  const voteOn = (v: MemberView) => (v.vote ? m.b.votes.find((r) => r.id === v.vote!.props.rollId)?.date : undefined);
  const traders = m.members
    .filter((v) => v.tradeCount)
    .sort(
      az
        ? (a, b) => lastName(a).localeCompare(lastName(b)) || a.node.label.localeCompare(b.node.label)
        : (a, b) =>
            tradesBefore(b, voteOn(b)) - tradesBefore(a, voteOn(a)) ||
            b.tradeCount - a.tradeCount ||
            lastName(a).localeCompare(lastName(b)),
    );
  const byParty = (list: MemberView[], party: "R" | "D" | "I") => list.filter((v) => v.node.props.party === party);
  const before = (v: MemberView) => v.funded.reduce((a, f) => a + f.edge.props.beforeUsd, 0);
  const funded = m.members.filter((v) => v.fundedUsd > 0).sort((a, b) => before(b) - before(a));
  const after = (v: MemberView) => v.funded.reduce((a, f) => a + f.edge.props.afterUsd, 0);
  const sum = (list: MemberView[]) => list.reduce((a, v) => a + before(v), 0);
  const spouse = traders.filter((v) => [...v.owners].some((o) => o !== "self")).length;
  const anyVoted = m.members.some((v) => v.vote);
  const parties = (["R", "D", "I"] as const).filter((p) => m.voters[p] > 0);
  const during = m.span ? `${day(m.span[0])} to ${day(m.span[1])}` : null;
  return (
    <div className="card" id="card-members">
      <h2>Members who traded those companies’ stock</h2>
      <p className="sub">
        Routine disclosures; no link to any vote is claimed. Members trade the shares of large companies all the time,
        and a company needs only one lobbying report or one mention in the text to be tied to a bill. {m.tradersDuring}{" "}
        of 535 members have a trade dated{" "}
        {during ? `from the first text to signing (${during})` : "inside the bill’s span"}; {traders.length} have one
        anywhere in the window (a year before the bill to a year after the law). Spouse, joint and child trades are
        listed under the member with the owner shown{spouse ? ` (${spouse} members have some)` : ""}.
      </p>
      <Gap m={m} kind="paper_filings_unread" />
      <div className="cap" style={{ marginTop: 4 }}>
        Traded stock of a tied company, among members {anyVoted ? "who voted" : "on the map"}
      </div>
      <div className="split">
        {parties.map((p) => (
          <span key={p}>
            {p} {m.tradersVoted[p]} of {m.voters[p]}
            {m.unread[p] > 0 && <span className="dim"> (+{m.unread[p]} unread)</span>}
          </span>
        ))}
        {m.tradersNoVote > 0 && <span className="dim">{m.tradersNoVote} traders cast no recorded vote</span>}
      </div>
      <div className="sortbar">
        <span className="cap">Order</span>
        <button type="button" aria-pressed={!az} onClick={() => setAz(false)}>
          Trades before the vote
        </button>
        <button type="button" aria-pressed={az} onClick={() => setAz(true)}>
          A to Z
        </button>
      </div>
      <ul className="rows">
        {traders.slice(0, 7).map((v) => (
          <MemberRow key={v.node.id} v={v} m={m} />
        ))}
        {!traders.length && (
          <li>
            <span className="miss">No member trades in tied companies found.</span>
          </li>
        )}
      </ul>
      {traders.length > 7 && (
        <details>
          <summary>All {traders.length} traders</summary>
          <ul className="rows">
            {traders.slice(7).map((v) => (
              <MemberRow key={v.node.id} v={v} m={m} />
            ))}
          </ul>
        </details>
      )}
      {funded.length > 0 && (
        <>
          <div className="cap" style={{ marginTop: 16 }}>
            PAC money from tied organizations, given before the member’s vote <Inf />
          </div>
          <p className="row-meta">
            Committee seats, leadership roles and being up for re-election explain most of the differences between
            members; no earlier cycle is shown to compare against.
          </p>
          <div className="split">
            {parties.map((p) => {
              const list = byParty(funded, p);
              return (
                <span key={p}>
                  {p} {usd(sum(list))} to {list.length} of {m.voters[p]}
                  {list.length > 0 && <span className="dim"> ({usd(sum(list) / list.length)} each)</span>}
                </span>
              );
            })}
          </div>
          <ul className="rows">
            {funded.slice(0, 6).map((v) => {
              const top = [...v.funded].sort((a, b) => b.edge.props.amountUsd - a.edge.props.amountUsd).slice(0, 2);
              return (
                <li key={v.node.id} {...row(v.node.id)}>
                  <div className="row-top">
                    <span className="t">
                      {v.node.label.replace(/\s*\(.*\)$/, "")}{" "}
                      <span className="tk">
                        {v.node.props.party}-{v.node.props.state}
                      </span>
                    </span>
                    <span className="num">{usd(before(v))} before</span>
                  </div>
                  <div className="row-meta">
                    {usd(after(v))} after {v.vote ? "the vote" : "enactment"}, {usd(v.fundedUsd)} in all · top:{" "}
                    {top.map((f) => nice(m.actorById.get(f.actor)?.label ?? f.actor)).join(", ")}
                    {v.committees.length > 0 && <> · {v.committees.map((c) => c.committee.label).join(", ")}</>}
                  </div>
                  <Sources ids={top.flatMap((f) => f.edge.claims)} />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

export function MissingCard({ m }: { m: BillModel }) {
  const shown = new Set(["attention_partial", "entity_recall", "paper_filings_unread"]);
  const rest = m.b.gaps.filter((g) => !shown.has(g.kind));
  return (
    <div className="card">
      <h2>What’s missing, and the rules</h2>
      <p className="sub">Gaps are shown where the data would be. Rules are the same for every bill and party.</p>
      <ul className="rows">
        {rest.map((g) => (
          <li key={g.id}>
            <div className="row-meta" style={{ color: "var(--text)" }}>
              {g.text} {g.claim && <Src id={g.claim} />}
            </div>
          </li>
        ))}
        {m.b.rules.map((r) => (
          <li key={r.id}>
            <div className="row-top">
              <span className="t" style={{ fontWeight: 500 }}>
                {r.id}
              </span>
              <span className="num">v{r.version}</span>
            </div>
            <div className="row-meta">
              {r.text}{" "}
              {r.url && (
                <a className="src" href={r.url} target="_blank" rel="noopener">
                  method
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="row-meta" style={{ marginTop: 10 }}>
        Party is a label here, never a color: the map, thresholds and wording treat every member the same.
      </p>
    </div>
  );
}
