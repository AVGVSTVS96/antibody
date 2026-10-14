import type { BundleIndex } from "@antibody/core";
import { type BillId, billDisplay, congressGovUrl, parseBillId } from "@antibody/core/ids";
import { type FormEvent, use, useEffect, useState } from "react";
import { loadIndex, prefetchBundle } from "../lib/data.ts";
import { CONGRESS_TAG, count, day, deficitWords, musd, stamp } from "../lib/format.ts";
import { billHref, navigate, onLink } from "../lib/router.ts";
import { Search } from "../ui/icons.tsx";
import { Top } from "../ui/Top.tsx";

type Entry = BundleIndex["bills"][number];

const PARTY = { R: "Republican", D: "Democratic", I: "Independent" } as const;
const START_HERE = "119-s-1582";

export function IndexPage() {
  const index = use(loadIndex());
  const [q, setQ] = useState("");
  const [notice, setNotice] = useState<React.ReactNode>(null);

  useEffect(() => {
    document.title = "antibody · X-ray any bill in Congress";
  }, []);

  const needle = q.trim().toLowerCase();
  const match = (b: Entry) =>
    !needle ||
    [b.id, b.display, b.title, b.shortTitle ?? "", b.law ?? ""].some((s) => s.toLowerCase().includes(needle));
  const bills = [...index.bills]
    .filter(match)
    .sort((a, b) => (b.latestActionOn ?? "").localeCompare(a.latestActionOn ?? ""));
  const byParty = (p: "R" | "D" | "I" | null) => bills.filter((b) => b.sponsorParty === p && !b.stats?.vehicle);
  const vehicles = bills.filter((b) => b.stats?.vehicle);
  const testable = index.bills.filter((b) => b.stats?.buriedTest.tested).length;

  function submit(e: FormEvent) {
    e.preventDefault();
    const raw = q.trim();
    if (!raw) return;
    let id: BillId | null = null;
    try {
      id = parseBillId(raw);
    } catch {}
    const hit = id ? index.bills.find((b) => b.id === id) : bills.length === 1 ? bills[0] : undefined;
    if (hit) return navigate(billHref(hit.id));
    if (!id) return setNotice(<>No bill matches “{raw}”. Try a number like S.1582, H.R. 1, or a congress.gov link.</>);
    setNotice(
      <>
        {billDisplay(id)} ({id.split("-")[0]}th Congress) isn’t x-rayed yet. Build it with{" "}
        <code>bun run antibody xray {id}</code>, or{" "}
        <a href={congressGovUrl(id)} target="_blank" rel="noopener">
          read it on congress.gov ↗
        </a>
        .
      </>,
    );
  }

  const parties: ("R" | "D" | "I")[] = byParty("I").length ? ["R", "D", "I"] : ["R", "D"];
  return (
    <>
      <Top right={`${count(index.bills.length, "bill")} x-rayed`} />
      <main className="home">
        <section className="hero">
          <h1>
            See what rides along in a bill, <em>and who is behind it.</em>
          </h1>
          <p>
            antibody x-rays federal bills: the headline fight, the sections added after a chamber passed the bill, who
            lobbied, who donated, and which members traded related stock. Every line links its public record, inferences
            are marked as inferences, and the same rules apply to every party.
          </p>
          <form className="search" onSubmit={submit}>
            <Search />
            <label className="sr" htmlFor="q">
              Find a bill
            </label>
            <input
              id="q"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setNotice(null);
              }}
              placeholder="S.1582, H.R. 1, GENIUS, or a congress.gov link"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit">X-ray</button>
          </form>
          {notice && <div className="notice">{notice}</div>}
        </section>

        <div className="section-h">
          <span className="cap">Curated bills</span>
          <span className="cap">grouped by the sponsor’s party</span>
        </div>
        <p className="extra colnote">
          Sponsor party is not who voted for it: the vote tally on each card shows how each party voted. The two columns
          also differ in era (all six Democratic-sponsored bills are from the 117th Congress, when Democrats held the
          House, Senate and White House), so read them as examples, not as a score between parties. {testable} of{" "}
          {index.bills.length} bills had enough news and a late flag to test for buried candidates at all.
        </p>
        <div className="cols">
          {parties.map((p) => {
            const list = byParty(p);
            return (
              <div className="col" key={p}>
                <div className="cap">
                  <span>{PARTY[p]} sponsor</span>
                  <span>{list.length}</span>
                </div>
                {list.map((b) => (
                  <BillCard key={b.id} b={b} />
                ))}
                {!list.length && (
                  <div className="empty">
                    {needle ? "No match on this side." : `No ${PARTY[p]}-sponsored bill is x-rayed yet.`}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {vehicles.length > 0 && (
          <>
            <div className="section-h">
              <span className="cap">Vehicle bills</span>
              <span className="cap">the sponsor introduced a different text than the law</span>
            </div>
            <div className="cols">
              <div className="col">
                {vehicles.map((b) => (
                  <BillCard key={b.id} b={b} />
                ))}
              </div>
            </div>
          </>
        )}

        <div className="section-h">
          <span className="cap">Latest watcher picks</span>
          <span className="cap">
            bills that moved and scored highest on a cheap check, daily; worth a look, not a verdict
          </span>
        </div>
        <div className="picks">
          {index.watch.length ? (
            <div className="card">
              <ul className="rows">
                {index.watch.slice(0, 12).map((w) => (
                  <li key={`${w.billId}-${w.seenAt}-${w.kind}`} className="pick">
                    <span className={`kind${w.kind === "hot" ? " hot" : ""}`}>
                      {w.kind === "hot" ? "worth a look" : w.kind.replace("_", " ")}
                    </span>
                    <span>
                      <b className="mono">{w.display}</b> {w.title}
                      {w.sponsorParty && <span className="row-meta"> · {PARTY[w.sponsorParty]} sponsor</span>}
                      {w.reason && <div className="row-meta">{w.reason}</div>}
                    </span>
                    <span className="row-top">
                      <span className="num">{stamp(w.seenAt)}</span>
                      {w.file ? (
                        <a className="src" href={billHref(w.billId)} onClick={onLink}>
                          x-ray
                        </a>
                      ) : (
                        <a className="src" href={w.url} target="_blank" rel="noopener">
                          source
                        </a>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="empty">The daily watcher hasn’t flagged a bill yet. Its picks show up here.</div>
          )}
        </div>

        <div className="section-h">
          <span className="cap">How to read an x-ray</span>
        </div>
        <div className="method">
          <div className="card">
            <h2>Facts and inferences</h2>
            <p>
              A fact is read straight from a public record and links to it. An inference is a judgment by a published
              rule; it is drawn dashed, tagged <span className="pill inf">inference</span>, and says what it rests on.
            </p>
          </div>
          <div className="card">
            <h2>Headline and buried candidates</h2>
            <p>
              Headline sections are the top tenth of a bill by news attention. A buried candidate has big stakes (a CBO
              figure of $10 billion or more, or about 20 lobbying reports), almost no news, and was added late or has
              little to do with the rest of the bill. Lobbying alone can give a section big stakes. The sub-scores sit
              next to every label, never just a verdict.
            </p>
          </div>
          <div className="card">
            <h2>Follow the money</h2>
            <p>
              Lobbying from LD-2 filings, PAC money from FEC filings, stock trades from House and Senate reports with
              the owner always shown, and CBO dollars with their baseline named.
            </p>
          </div>
          <div className="card">
            <h2>Same rules for everyone</h2>
            <p>
              Thresholds, colors and wording are identical for every party and member. Party is a label, never a color.
              What we couldn’t read yet is shown as missing, not left out. News attention weights left, center and right
              outlets equally by side, but the sides are not built alike (the right side has fewer outlets, and the
              groups come from 2019 sharing data), so a quiet section is a lead to check.
            </p>
          </div>
        </div>
      </main>
      <footer className="foot">
        Public, citable data only: congress.gov, GovInfo, CBO, lda.gov, FEC, House Clerk, Senate eFD, SEC EDGAR. Source
        code and method on{" "}
        <a href="https://github.com/AVGVSTVS96/antibody" target="_blank" rel="noopener">
          GitHub
        </a>
        . Index built {day(index.generatedAt.slice(0, 10))}.
      </footer>
    </>
  );
}

function hook(b: Entry): string {
  const s = b.stats;
  if (!s) return "";
  const parts = [
    s.deficitMusd != null ? `CBO says it ${deficitWords(s.deficitMusd)}` : null,
    s.late ? `${s.late} ${s.late === 1 ? "section was" : "sections were"} added late` : null,
    s.lobbyingReports ? `${s.lobbyingReports.toLocaleString("en-US")} lobbying reports name it` : null,
  ].filter(Boolean);
  return parts.length ? `${parts.join("; ")}.` : "";
}

function buriedLine(s: NonNullable<Entry["stats"]>) {
  if (!s.buriedTest.tested) return `Buried candidates: not tested (${s.buriedTest.why}).`;
  if (s.buried > 0)
    return `Buried candidates: ${s.buried} of ${s.buriedTest.bigStakes} big-stakes ${s.buriedTest.bigStakes === 1 ? "section" : "sections"}.`;
  if (s.buriedTest.bigStakes === 0) return "Tested for buried candidates: no section has big stakes.";
  return `Buried candidates: 0 of ${s.buriedTest.bigStakes} big-stakes ${s.buriedTest.bigStakes === 1 ? "section" : "sections"}${s.buriedTest.why ? ` (${s.buriedTest.why})` : ""}.`;
}

function BillCard({ b }: { b: Entry }) {
  const s = b.stats;
  const party = s?.tally?.byParty;
  return (
    <a
      className="billcard"
      href={billHref(b.id)}
      onClick={onLink}
      onPointerEnter={() => prefetchBundle(b.id)}
      onFocus={() => prefetchBundle(b.id)}
    >
      <Fingerprint kinds={s?.fingerprint ?? ""} label={b.display} />
      <div>
        {b.id === START_HERE && <span className="badge-start">Start with this one</span>}
        <div className="cap">
          {b.display}
          {b.sponsorParty ? ` · ${b.sponsorParty} sponsor` : ""}
          {b.law ? ` · ${b.law}` : ""}
          {b.latestActionOn ? ` · ${day(b.latestActionOn)}` : ""}
        </div>
        <h3>{b.shortTitle ?? b.title}</h3>
        {s && hook(b) && <div className="hook">{hook(b)}</div>}
        {b.shortTitle && <div className="meta">{b.title}</div>}
        {s && (
          <>
            <div className="tags">
              {b.congress ? (
                <span title={CONGRESS_TAG[b.congress]}>
                  {CONGRESS_TAG[b.congress]?.split(" · ")[0] ?? `${b.congress}th Congress`}
                </span>
              ) : null}
              {s.tally && (
                <span>
                  {s.tally.chamber} vote{" "}
                  <b>
                    {s.tally.yeas}-{s.tally.nays}
                  </b>
                  {party && (
                    <>
                      {" "}
                      (
                      {(["R", "D", "I"] as const)
                        .filter((p) => party[p])
                        .map((p) => `${p} ${party[p]!.yea}-${party[p]!.nay}`)
                        .join(", ")}
                      )
                    </>
                  )}
                </span>
              )}
            </div>
            <div className="tests">{buriedLine(s)}</div>
            <div className="nums">
              <span>
                <b>{s.sections}</b> sections
              </span>
              <span>
                <b>{s.lobbyingReports.toLocaleString("en-US")}</b> lobbying reports
              </span>
              <span title="Members of Congress with a stock trade dated from the bill's first text through its signing in a company tied to the bill. Routine disclosures; no link to any vote is claimed. Members trade large companies' shares all the time.">
                <b>{s.membersTradedDuring}</b> of 535 members traded stock in affected companies while it moved
              </span>
              {s.deficitMusd != null && (
                <span>
                  <b>{musd(s.deficitMusd)}</b> deficit
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </a>
  );
}

/** The bill's sections in order around a ring: gold headline, red buried, violet the rest, faint where unscored. */
function Fingerprint({ kinds, label }: { kinds: string; label: string }) {
  const n = Math.max(kinds.length, 1);
  const gap = n > 120 ? 0 : 0.012;
  const arc = (i: number, r: number) => {
    const a0 = (i / n) * Math.PI * 2 - Math.PI / 2 + gap;
    const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2 - gap;
    const p = (a: number) => `${(44 + Math.cos(a) * r).toFixed(2)},${(44 + Math.sin(a) * r).toFixed(2)}`;
    return `M${p(a0)}A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0},1 ${p(a1)}`;
  };
  const tone = { h: "var(--gold)", b: "var(--red)", n: "var(--violet)", u: "var(--line-2)" } as const;
  const c = { h: 0, b: 0, n: 0, u: 0 };
  for (const k of kinds) c[k as keyof typeof c]++;
  return (
    <svg viewBox="0 0 88 88" role="img" aria-label={`${kinds.length} sections: ${c.h} headline, ${c.b} buried`}>
      <circle cx="44" cy="44" r="30" fill="var(--band-1)" />
      {[...kinds].map((k, i) => (
        <path
          // biome-ignore lint/suspicious/noArrayIndexKey: sections are drawn in order and never reorder
          key={i}
          d={arc(i, 36)}
          fill="none"
          stroke={tone[k as keyof typeof tone]}
          strokeWidth={k === "h" || k === "b" ? 9 : 6}
          opacity={k === "n" ? 0.55 : 1}
        />
      ))}
      <circle cx="44" cy="44" r="17" fill="var(--seal)" stroke="var(--red)" strokeWidth="1" />
      <text x="44" y="47" textAnchor="middle" fontSize="8" fontFamily="var(--mono)" fill="var(--red)" fontWeight="600">
        {label.length > 8 ? label.replace(/\.$/, "").slice(0, 8) : label}
      </text>
    </svg>
  );
}
