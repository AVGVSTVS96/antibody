import { BIG_STAKES, type BundleIndex } from "@antibody/core";
import { use, useEffect, useState } from "react";
import { loadIndex, prefetchBundle } from "../lib/data.ts";
import { count, day } from "../lib/format.ts";
import { useMedia } from "../lib/media.ts";
import { billHref, navigate, onLink } from "../lib/router.ts";
import { matchBills, missingBill } from "../ui/Find.tsx";
import { Fingerprint, fingerprintNote } from "../ui/Fingerprint.tsx";
import { Search } from "../ui/icons.tsx";
import { Footer, Top } from "../ui/Top.tsx";
import { partyWord, picksNote, signedLine } from "./home.ts";

type Entry = BundleIndex["bills"][number];

const START_HERE = "119-s-1582";

export function IndexPage() {
  const index = use(loadIndex());
  const [q, setQ] = useState("");
  const [notice, setNotice] = useState<React.ReactNode>(null);

  useEffect(() => {
    document.title = "antibody · X-ray any bill in Congress";
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, []);

  const curated = index.bills
    .filter((b) => b.origin !== "watcher")
    .sort(
      (a, b) =>
        Number(b.id === START_HERE) - Number(a.id === START_HERE) ||
        (b.latestActionOn ?? "").localeCompare(a.latestActionOn ?? ""),
    );
  const watched = index.bills
    .filter((b) => b.origin === "watcher")
    .sort((a, b) => (b.addedOn ?? "").localeCompare(a.addedOn ?? "") || b.id.localeCompare(a.id));
  const key = index.bills.find((b) => b.id === "117-hr-5376" && b.stats?.fingerprint) ?? curated[0];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const raw = q.trim();
    if (!raw) return;
    const hits = matchBills(index.bills, raw);
    const id = missingBill(raw);
    const exact = id ? index.bills.find((b) => b.id === id) : undefined;
    const hit = exact ?? (hits.length === 1 ? hits[0] : undefined);
    if (hit) return navigate(billHref(hit.id));
    if (hits.length) return setNotice(<>{count(hits.length, "bill")} match. Pick one below, or be more specific.</>);
    if (!id) return setNotice(<>No bill matches “{raw}”. Try a number like S.1582, H.R. 1, or a congress.gov link.</>);
    setNotice(
      <>
        That bill isn’t x-rayed yet. The daily watch x-rays the bills that move, or build it with{" "}
        <code>bun run antibody xray {id}</code>.
      </>,
    );
  }

  const needle = q.trim();
  const shown = needle ? new Set(matchBills(index.bills, needle).map((b) => b.id)) : null;
  const seen = (b: Entry) => !shown || shown.has(b.id);
  const testable = curated.filter((b) => b.stats?.buriedTest.tested).length;

  return (
    <>
      <Top />
      <main>
        <section className="wrap hero">
          <div className="hero-copy">
            <h1>See what rides along in a bill, and who is behind it.</h1>
            <p className="lead">
              Which parts of a law made the news, which costly parts didn’t, who lobbied on it, and which members traded
              stock in companies tied to it. Every number links to its public record.
            </p>
            <form className="bigfind" onSubmit={submit}>
              <span className="bf-field">
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
                  placeholder="Try “Inflation Reduction Act” or H.R.5376"
                  autoComplete="off"
                  spellCheck={false}
                />
              </span>
              <button type="submit" className="press">
                X-ray it
              </button>
            </form>
            {notice && <p className="notice">{notice}</p>}
          </div>
          {key?.stats && <Key entry={key} />}
        </section>

        <section className="wrap list" aria-labelledby="laws">
          <header className="list-h">
            <h2 id="laws">{count(curated.length, "law")}, x-rayed</h2>
            <p>Newest first. Sponsor party is a label, not a score.</p>
          </header>
          <Rows bills={curated.filter(seen)} feature={needle ? undefined : START_HERE} />
          {!curated.some(seen) && <p className="empty">No curated law matches that search.</p>}
          <p className="era-note">
            The bills come from different eras: all six with Democratic sponsors are from the 117th Congress, when
            Democrats held the House, Senate and White House. Read them as examples, not a sample.
          </p>
        </section>

        {watched.some(seen) && (
          <section className="wrap list" aria-labelledby="watched">
            <header className="list-h">
              <h2 id="watched">Added by the daily watch</h2>
              <p>X-rayed automatically the day they moved. Not hand-checked.</p>
            </header>
            <Rows bills={watched.filter(seen)} />
          </section>
        )}

        <Picks index={index} />

        <section className="wrap read" id="read" aria-labelledby="readh">
          <h2 id="readh">How we read bills</h2>
          <div className="read-g">
            <article>
              <h3>Facts and inferences</h3>
              <p>
                A fact is read straight from a public record and links to it. An inference is a judgment by a published
                rule; it is drawn dashed, tagged <span className="pill inf">inference</span>, and says what it rests on.
              </p>
            </article>
            <article>
              <h3>Loud and quiet sections</h3>
              <p>
                Loud sections are the top tenth of a bill by news attention. A quiet and costly one has big stakes (a
                CBO figure of $10 billion or more for that section on every baseline CBO printed, or 21 lobbying
                reports) and under 1 in 100 of the bill’s news articles discussed it. Being added late or off-topic
                ranks it higher but isn’t needed. The sub-scores sit next to every label, never just a verdict.{" "}
                {testable} of {curated.length} laws here had enough news, enough sections and a measured cost to test at
                all.
              </p>
            </article>
            <article>
              <h3>Follow the money</h3>
              <p>
                Lobbying from LD-2 filings, PAC money from FEC filings, stock trades from House and Senate reports with
                the owner always shown, and CBO dollars with their baseline named.
              </p>
            </article>
            <article>
              <h3>Same rules for everyone</h3>
              <p>
                Thresholds, colors and wording are identical for every party and member. Party is a label, never a
                color. What we couldn’t read yet is shown as missing, not left out. News attention weights left, center
                and right outlets equally by side, but the sides are not built alike, so a quiet section is a lead to
                check.
              </p>
            </article>
          </div>
        </section>
      </main>
      <Footer>
        <span>
          Public, citable data only: congress.gov, GovInfo, CBO, lda.gov, FEC, House Clerk, Senate eFD, SEC EDGAR.
        </span>
        <span>
          Source code and method on{" "}
          <a href="https://github.com/AVGVSTVS96/antibody" target="_blank" rel="noopener">
            GitHub
          </a>
          . Index built {day(index.generatedAt.slice(0, 10))}.
        </span>
      </Footer>
    </>
  );
}

function Key({ entry }: { entry: Entry }) {
  const s = entry.stats!;
  return (
    <aside className="key" aria-label="How to read a fingerprint">
      <p className="key-t">Every bill gets a fingerprint</p>
      <Fingerprint kinds={s.fingerprint} label={entry.display} big />
      <p className="key-d">
        One square per section of the law, in order. This is the {entry.shortTitle ?? entry.display}’s{" "}
        {s.sections.toLocaleString("en-US")}.
      </p>
      <ul className="key-l">
        <li>
          <i className="sq iris" />
          The loud part: what the news covered most
        </li>
        <li>
          <i className="sq flare" />
          Quiet and costly: big stakes, almost no news
        </li>
        <li>
          <i className="sq quiet" />
          Everything else
        </li>
      </ul>
    </aside>
  );
}

function Rows({ bills, feature }: { bills: Entry[]; feature?: string }) {
  const phone = useMedia("(max-width: 760px)");
  return (
    <>
      <div className="laws-h" aria-hidden="true">
        <span className="c-fp">One square per section</span>
        <span className="c-law">Law</span>
        <span className="c-loud">Loud</span>
        <span className="c-quiet">Quiet and costly</span>
        <span className="c-lobby">Lobbying reports</span>
        <span className="c-traded">Members traded</span>
      </div>
      <ul className="laws">
        {bills.map((b) => (
          <Row key={b.id} b={b} start={b.id === feature} phone={phone} />
        ))}
      </ul>
    </>
  );
}

function Row({ b, start, phone }: { b: Entry; start: boolean; phone: boolean }) {
  const s = b.stats;
  const t = s?.buriedTest;
  const short = !!t && !t.tested && !!t.why?.startsWith("the bill has only");
  const unranked = !!t && !t.tested && !short && !!t.why?.startsWith("too few");
  const cannotFire = !!t && !t.tested && !short && !unranked;
  const note = s && fingerprintNote(s.fingerprint, phone);
  return (
    <li>
      <a
        className="lawrow"
        href={billHref(b.id)}
        onClick={onLink}
        onPointerEnter={() => prefetchBundle(b.id)}
        onFocus={() => prefetchBundle(b.id)}
      >
        <span className="c-fp">
          {s && <Fingerprint kinds={s.fingerprint} label={b.display} />}
          {note && <small>{note}</small>}
        </span>
        <span className="c-law">
          <span className="law-t">
            <b>{b.shortTitle ?? b.title}</b>
            {start && <span className="badge">Start with this one</span>}
            {b.origin === "watcher" && <span className="badge watch">Added by the watch</span>}
          </span>
          <span className="law-m">{signedLine(b)}</span>
          {b.origin === "watcher" && b.note && (
            <span className="law-n" title={b.note}>
              {b.note}
            </span>
          )}
        </span>
        {s && (
          <span className="stats">
            {short ? (
              <span className="c-both">Only {count(s.sections, "section")}: nothing to bury</span>
            ) : unranked ? (
              <span className="c-both">Too few articles to rank sections</span>
            ) : (
              <>
                <span className="c-loud">
                  <b className="n loud">{s.headline}</b>
                  <i>Loud</i>
                </span>
                <span
                  className="c-quiet"
                  title={
                    t?.tested && !s.buried
                      ? `Tested on the ${t.costMeasured} of ${s.sections} sections CBO gave a figure, plus any named in ${BIG_STAKES.reports} lobbying reports`
                      : undefined
                  }
                >
                  {cannotFire ? (
                    <b className="soft" title={t?.why ?? undefined}>
                      Can’t be tested
                    </b>
                  ) : (
                    <b className={`n ${s.buried ? "flare" : "zero"}`}>{s.buried}</b>
                  )}
                  <i>Quiet and costly</i>
                </span>
              </>
            )}
            <span className="c-lobby">
              <b className="n">{s.lobbyingReports.toLocaleString("en-US")}</b>
              <i>Lobbying reports</i>
            </span>
            <span className="c-traded">
              <b className="n">{s.membersTradedDuring.toLocaleString("en-US")}</b>
              <i>Members traded</i>
            </span>
          </span>
        )}
      </a>
    </li>
  );
}

function Picks({ index }: { index: BundleIndex }) {
  const picks = index.watch.slice(0, 12);
  if (!picks.length)
    return (
      <section className="wpicks">
        <div className="wrap">
          <header className="list-h">
            <h2>New this week</h2>
          </header>
          <p className="empty">The daily watch hasn’t flagged a bill yet. Its picks show up here.</p>
        </div>
      </section>
    );
  return (
    <section className="wpicks" aria-labelledby="picksh">
      <div className="wrap">
        <header className="list-h">
          <h2 id="picksh">New this week</h2>
          <p>A daily check flags bills that moved. A lead, not a verdict.</p>
        </header>
        <ul className="wpick-g">
          {picks.map((w) => {
            const [lead = "Moved this week", ...rest] = picksNote(w);
            const xrayed = !!w.file;
            return (
              <li key={w.billId} className="wpick">
                <span className={`wpick-k${lead.startsWith("Became law") ? " law" : ""}`}>{lead}</span>
                <h3>{w.title}</h3>
                <p>
                  {w.display}
                  {w.sponsorParty ? `, ${partyWord(w.sponsorParty)} sponsor` : ""}.
                  {rest.length ? ` ${rest.join(" ")}` : ""}
                </p>
                {xrayed ? (
                  <a
                    className="link"
                    href={billHref(w.billId)}
                    onClick={onLink}
                    onPointerEnter={() => prefetchBundle(w.billId)}
                  >
                    Open the x-ray
                  </a>
                ) : (
                  <a className="link" href={w.url} target="_blank" rel="noopener">
                    Read on congress.gov
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
