import type { Dollar } from "@antibody/core";
import { count, day, musd, nice, pct, usd } from "../lib/format.ts";
import type { Actor, BillModel, MemberView, SectionView } from "../lib/model.ts";
import { Inf, Sources, Src } from "../ui/claims.tsx";
import { useRowFocus } from "./focus.ts";

const MEASURE = { deficit: "Deficit", outlays: "Outlays", revenues: "Revenues", budget_authority: "Budget authority" };

export const secId = (v: SectionView) => `section:${v.s.id}`;

export function BillCard({ m }: { m: BillModel }) {
  const { b } = m;
  const deficits = b.dollars.wholeBill.filter((d) => d.measure === "deficit");
  const lawDeficit = deficits.find((d) => d.baseline === "current-law") ?? deficits[0];
  const policyDeficit = deficits.find((d) => d.baseline === "current-policy");
  const est = b.dollars.estimates.find((e) => e.id === lawDeficit?.estimateId) ?? b.dollars.estimates[0];
  const amend = b.amendments;
  const byStatus = (s: string) => amend.filter((a) => a.status === s).length;
  return (
    <div className="card">
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
        {b.bill.shortTitle ? `${b.bill.title}. ` : ""}
        {m.sponsor && <>Sponsor {m.sponsor.label}. </>}
        <Sources ids={b.bill.claims} />{" "}
        <a className="src" href={b.bill.billstatusUrl} target="_blank" rel="noopener">
          BILLSTATUS
        </a>
      </p>
      <div className="stats">
        <div className="stat">
          <div className="k">{lawDeficit ? `Deficit ${lawDeficit.period}` : "Deficit"}</div>
          {lawDeficit ? (
            <>
              <div className="v">{musd(lawDeficit.amountMusd)}</div>
              <div className="n">
                {lawDeficit.baseline} <Src id={lawDeficit.claim} label="CBO" />
              </div>
            </>
          ) : (
            <>
              <div className="v missing">No CBO score</div>
              <div className="n">none published</div>
            </>
          )}
        </div>
        {policyDeficit ? (
          <div className="stat">
            <div className="k">Same, current policy</div>
            <div className="v">{musd(policyDeficit.amountMusd)}</div>
            <div className="n">
              baseline <Src id={policyDeficit.claim} label="CBO" />
            </div>
          </div>
        ) : (
          <div className="stat">
            <div className="k">Mandates</div>
            {est?.mandates ? (
              <>
                <div className="v small">{est.mandates.privateSector.replace(/^Yes, /, "")}</div>
                <div className="n">
                  private sector <Src id={est.mandates.claim} label="CBO" />
                </div>
              </>
            ) : (
              <div className="v missing">Not stated</div>
            )}
          </div>
        )}
        <div className="stat">
          <div className="k">$ per section</div>
          {m.perSectionDollars ? (
            <>
              <div className="v small">Published</div>
              <div className="n">see the sections list</div>
            </>
          ) : (
            <>
              <div className="v missing">Not published</div>
              <div className="n">CBO scored only the whole bill</div>
            </>
          )}
        </div>
      </div>
      {est && (
        <div className="row-meta" style={{ marginTop: 6 }}>
          Scored: {est.versionScored}. Baseline: <b>{est.baselineLabel}</b>.{" "}
          {b.dollars.wholeBill
            .filter((d) => d.measure !== "deficit" && d.baseline === est.baseline)
            .map((d: Dollar) => (
              <span key={d.claim}>
                {MEASURE[d.measure]} {musd(d.amountMusd)} <Src id={d.claim} label="CBO" />{" "}
              </span>
            ))}
        </div>
      )}
      {b.votes.length > 0 && (
        <>
          <div className="cap" style={{ marginTop: 14 }}>
            Roll call votes
          </div>
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
        </>
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
            <span>{byStatus("no_action")} no floor action</span>
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

const groups = ["left", "center-left", "center", "center-right", "right", "wire", "tv"] as const;

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

export function HeadlineCard({ m }: { m: BillModel }) {
  const row = useRowFocus();
  const A = m.b.attention;
  const scored = m.sections.filter((v) => v.s.attention?.pct != null).length;
  const via =
    A.via.map((v) => (v === "mediacloud" ? "Media Cloud" : "Google News")).join(" + ") || "no news source yet";
  return (
    <div className="card">
      <h2>Headline</h2>
      <p className="sub">
        Sections with the most news attention among {scored} scored, from {count(A.articles, "article")} via {via}
        {A.outletListVersion ? `, outlet list ${A.outletListVersion}` : ""}
        {A.window ? ` (${day(A.window[0])} to ${day(A.window[1])})` : ""}.
      </p>
      <Gap m={m} kind="attention_partial" />
      <ul className="rows">
        {m.headline.map((v) => (
          <li key={v.s.id} {...row(secId(v))}>
            <div className="row-top">
              <span className="t">
                §{v.s.num} {v.s.heading}
              </span>
              <span className="num">pct {pct(v.s.attention?.pct)}</span>
            </div>
            <div className="bar">
              <i style={{ width: `${(v.s.attention?.pct ?? 0) * 100}%` }} />
            </div>
            <div className="row-meta">{count(v.s.attention?.hits ?? 0, "matched news unit")}</div>
            {v.s.attention && <AttentionSplit a={v.s.attention} />}
            <Sources
              ids={[v.s.attention?.claim, ...(v.s.attention?.examples.map((e) => e.claim) ?? []), v.s.claims[0]]}
            />
          </li>
        ))}
        {!m.headline.length && (
          <li>
            <span className="miss">No section clears the headline bar on this bill.</span>
          </li>
        )}
        {A.general && (
          <li {...row(m.billNode)}>
            <div className="row-top">
              <span className="t">The bill as a whole</span>
              <span className="num">{A.general.hits} units</span>
            </div>
            <div className="row-meta">
              News that matched no single section better than the bill in general: often the loudest fight is about
              something that isn’t in the text.
            </div>
            <AttentionSplit a={A.general} />
            <Sources ids={[A.general.claim, ...A.general.examples.map((e) => e.claim)]} />
          </li>
        )}
      </ul>
    </div>
  );
}

function SectionFacts({ m, v }: { m: BillModel; v: SectionView }) {
  const inserted = m.edges.filter((e) => e.kind === "inserted" && e.dst === secId(v));
  const sc = v.s.score;
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
      {sc && (
        <div className="subs">
          <span>
            attention pct <b>{pct(sc.components.attentionPct)}</b>
          </span>
          <span>
            late <b>{sc.components.late ? "yes" : "no"}</b>
          </span>
          <span>
            CBO $ <b>{sc.components.dollarsMusd == null ? "—" : musd(sc.components.dollarsMusd)}</b>
            {sc.components.dollarsSplit === "even_split" ? " (split)" : ""}
          </span>
          <span>
            lobbying <b>{sc.components.lobbyingReports}</b>
          </span>
          {sc.components.offTopic != null && (
            <span>
              off-topic <b>{pct(sc.components.offTopic)}</b>
            </span>
          )}
        </div>
      )}
    </>
  );
}

export function BuriedCard({ m }: { m: BillModel }) {
  const row = useRowFocus();
  const rule = m.b.rules.find((r) => r.id === "buried");
  const late = m.sections.filter((v) => v.s.inFinal && v.s.late && v.kind !== "buried");
  const removed = m.sections.filter((v) => !v.s.inFinal);
  return (
    <div className="card">
      <h2>
        Buried candidates <Inf />
      </h2>
      <p className="sub">
        {rule ? `Rule: ${rule.text}` : "Rule: added late and quiet."} Lateness comes from the text versions (fact);
        quietness from news attention.
      </p>
      <ul className="rows">
        {m.buried.map((v) => (
          <li key={v.s.id} {...row(secId(v))}>
            <div className="row-top">
              <span className="t">
                §{v.s.num} {v.s.heading}
              </span>
              <span className="pill buried">{v.s.late ? "late + quiet" : "quiet + money"}</span>
            </div>
            <div className="quote">{v.s.preview}…</div>
            <SectionFacts m={m} v={v} />
            <Sources ids={[v.s.score?.claim, v.s.attention?.claim, ...v.s.dollars.map((d) => d.claim)]} />
          </li>
        ))}
        {!m.buried.length && (
          <li>
            <span className="miss">No section meets the buried rule on this bill.</span>
          </li>
        )}
      </ul>
      {late.length > 0 && (
        <details>
          <summary>Added late but not quiet ({late.length})</summary>
          <ul className="rows">
            {late.map((v) => (
              <li key={v.s.id} {...row(secId(v))}>
                <div className="row-top">
                  <span className="t" style={{ fontWeight: 500 }}>
                    §{v.s.num} {v.s.heading}
                  </span>
                  <span className="num">pct {pct(v.s.attention?.pct)}</span>
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
          <summary>Quiet but not late ({m.quiet.length})</summary>
          <ul className="rows">
            {m.quiet.map((v) => (
              <li key={v.s.id} {...row(secId(v))}>
                <div className="row-top">
                  <span className="t" style={{ fontWeight: 500 }}>
                    §{v.s.num} {v.s.heading}
                  </span>
                  <span className="num">pct {pct(v.s.attention?.pct)}</span>
                </div>
                <Sources ids={[v.s.attention?.claim, v.s.claims[0]]} />
              </li>
            ))}
          </ul>
        </details>
      )}
      {removed.length > 0 && (
        <details>
          <summary>Cut along the way ({removed.length})</summary>
          <ul className="rows">
            {removed.map((v) => (
              <li key={v.s.id} {...row(secId(v))}>
                <div className="row-top">
                  <span className="t" style={{ fontWeight: 500 }}>
                    §{v.s.num} {v.s.heading}
                  </span>
                  <span className="pill removed">
                    {v.s.mergedInto ? "merged" : v.s.splitInto.length ? "split" : "removed"}
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
        {a.spendUsd != null && <> · {usd(a.spendUsd)} total on those quarters</>}
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
  return (
    <div className="card">
      <h2>Who lobbied</h2>
      <p className="sub">LD-2 lobbying reports that name the bill. Each client links to a filing.</p>
      <div className="stats">
        <div className="stat">
          <div className="k">Reports</div>
          <div className="v">{L.reports.toLocaleString("en-US")}</div>
          <div className="n">{L.byPhase.bill} while a bill</div>
        </div>
        <div className="stat">
          <div className="k">Clients</div>
          <div className="v">{L.clients}</div>
          <div className="n">
            {L.lobbyists} lobbyists, {L.registrants} firms
          </div>
        </div>
        <div className="stat">
          <div className="k">Spend, bill share</div>
          <div className="v">{usd(L.shareEstimateUsd)}</div>
          <div className="n">
            of {usd(L.spendTotalUsd)} total <Inf />
          </div>
        </div>
      </div>
      <div className="row-meta" style={{ margin: "6px 0 2px" }}>
        LD-2s report one total for every issue, so the bill’s share is an estimate; the total is the fact.{" "}
        <Sources ids={L.claims} />
      </div>
      <div className="split" role="img" aria-label="Reports by phase">
        <span>while a bill {Math.round((L.byPhase.bill / total) * 100)}%</span>
        <span>quarter of enactment {Math.round((L.byPhase.enactmentQuarter / total) * 100)}%</span>
        <span>after it became law {Math.round((L.byPhase.law / total) * 100)}%</span>
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
          <summary>Former government staff lobbying on it ({withPositions.length})</summary>
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
  const tied = m.actors
    .filter((a) => a.benefits)
    .sort((x, y) => y.traders.size - x.traders.size || y.reports - x.reports);
  return (
    <div className="card">
      <h2>
        Who benefits <Inf />
      </h2>
      <p className="sub">
        {rule ? `Rule: ${rule.text}` : "Companies tied to the bill."} A tie is not proof of gain; it is where to look.
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
              {a.traders.size > 0 && <> · {a.traders.size} members traded its stock</>}
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
      <Sources ids={[...v.trades.flatMap((t) => t.claims), ...(v.vote?.claims ?? [])]} max={4} />
    </li>
  );
}

export function MembersCard({ m }: { m: BillModel }) {
  const row = useRowFocus();
  const traders = m.members.filter((v) => v.tradeCount).sort((a, b) => b.tradeCount - a.tradeCount);
  const funded = m.members.filter((v) => v.fundedUsd > 0).sort((a, b) => b.fundedUsd - a.fundedUsd);
  const byParty = (list: MemberView[], party: "R" | "D" | "I") => list.filter((v) => v.node.props.party === party);
  const sum = (list: MemberView[]) => list.reduce((a, v) => a + v.fundedUsd, 0);
  const spouse = traders.filter((v) => [...v.owners].some((o) => o !== "self")).length;
  return (
    <div className="card">
      <h2>Members with stakes</h2>
      <p className="sub">
        Members who traded stock in a company tied to the bill, or took PAC money from one. Spouse, joint and child
        trades are listed under the member with the owner shown{spouse ? ` (${spouse} members have some)` : ""}.
      </p>
      <Gap m={m} kind="paper_filings_unread" />
      <div className="cap" style={{ marginTop: 4 }}>
        Traded stock of a tied company
      </div>
      <div className="split">
        <span>R {byParty(traders, "R").length}</span>
        <span>D {byParty(traders, "D").length}</span>
        <span>I {byParty(traders, "I").length}</span>
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
            PAC money from tied organizations <Inf />
          </div>
          <div className="split">
            {(["R", "D", "I"] as const).map((p) => (
              <span key={p}>
                {p} {usd(sum(byParty(funded, p)))} → {byParty(funded, p).length}
              </span>
            ))}
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
                    <span className="num">{usd(v.fundedUsd)}</span>
                  </div>
                  <div className="row-meta">
                    top: {top.map((f) => nice(m.actorById.get(f.actor)?.label ?? f.actor)).join(", ")}
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
