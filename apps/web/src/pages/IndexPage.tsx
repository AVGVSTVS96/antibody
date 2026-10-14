import type { BundleIndex } from "@antibody/core";
import { type BillId, billDisplay, congressGovUrl, parseBillId } from "@antibody/core/ids";
import { type FormEvent, use, useEffect, useState } from "react";
import { loadIndex, prefetchBundle } from "../lib/data.ts";
import { ago, count, day, musd } from "../lib/format.ts";
import { billHref, navigate, onLink } from "../lib/router.ts";
import { Search } from "../ui/icons.tsx";
import { Top } from "../ui/Top.tsx";

type Entry = BundleIndex["bills"][number];

const PARTY = { R: "Republican", D: "Democratic", I: "Independent" } as const;

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
  const byParty = (p: "R" | "D" | "I" | null) => bills.filter((b) => b.sponsorParty === p);

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
            antibody x-rays federal bills: the headline fight, the sections added late and quietly, who lobbied, who
            paid, who benefits, and which members traded the stock. Every line links its public record, inferences are
            marked as inferences, and the same rules apply to every party.
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
          <span className="cap">grouped by sponsor’s party, so both sides sit side by side</span>
        </div>
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

        <div className="section-h">
          <span className="cap">Latest watcher picks</span>
          <span className="cap">new text versions, enrolled bills and hot fights, checked daily</span>
        </div>
        <div className="picks">
          {index.watch.length ? (
            <div className="card">
              <ul className="rows">
                {index.watch.slice(0, 12).map((w) => (
                  <li key={`${w.billId}-${w.seenAt}-${w.kind}`} className="pick">
                    <span className={`kind${w.kind === "hot" ? " hot" : ""}`}>{w.kind.replace("_", " ")}</span>
                    <span>
                      <b className="mono">{w.display}</b> {w.title}
                      {w.reason && <div className="row-meta">{w.reason}</div>}
                    </span>
                    <span className="row-top">
                      <span className="num">{ago(w.seenAt)}</span>
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
            <h2>Headline and buried</h2>
            <p>
              Headline sections draw the most news attention. A buried candidate came in late and stayed quiet, or moves
              money with little notice. The sub-scores sit next to every label, never just a verdict.
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
              What we couldn’t read yet is shown as missing, not left out.
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

function BillCard({ b }: { b: Entry }) {
  const s = b.stats;
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
        <div className="cap">
          {b.display}
          {b.law ? ` · ${b.law}` : ""}
          {b.latestActionOn ? ` · ${day(b.latestActionOn)}` : ""}
        </div>
        <h3>{b.shortTitle ?? b.title}</h3>
        {b.shortTitle && <div className="meta">{b.title}</div>}
        {s && (
          <div className="nums">
            <span>
              <b>{s.sections}</b> sections
            </span>
            {s.buried > 0 && (
              <span className="r">
                <b>{s.buried}</b> buried
              </span>
            )}
            <span>
              <b>{s.lobbyingReports.toLocaleString("en-US")}</b> lobbying reports
            </span>
            {s.membersTraded > 0 && (
              <span>
                <b>{s.membersTraded}</b> members traded
              </span>
            )}
            {s.deficitMusd != null && (
              <span>
                <b>{musd(s.deficitMusd)}</b> deficit
              </span>
            )}
          </div>
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
