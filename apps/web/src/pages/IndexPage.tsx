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
  const featured = needle ? undefined : bills.find((b) => b.id === START_HERE);
  const rest = bills.filter((b) => b !== featured);
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

  return (
    <>
      <Top right={`${count(index.bills.length, "bill")} x-rayed`} />
      <main className="home">
        <section className="hero">
          <h1>
            See what rides along in a bill, <em>and who is behind it.</em>
          </h1>
          <p>
            The headline fight, what got added late, who lobbied and paid, and which members traded related stock. Every
            line links its public record.
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
          <span className="cap">newest first</span>
        </div>
        <p className="partynote">
          <b>Sponsor party is a label, not a score.</b> Bills come from different eras: all six Democratic-sponsored
          ones are from the 117th Congress, when Democrats held the House, Senate and White House. Read them as
          examples. <a href="#read">How this works</a>
        </p>
        {featured && (
          <div className="feature">
            <BillCard b={featured} big />
          </div>
        )}
        <div className="grid">
          {rest.map((b) => (
            <BillCard key={b.id} b={b} />
          ))}
          {!bills.length && <div className="empty">No bill matches that search.</div>}
        </div>

        <div className="section-h">
          <span className="cap">Latest watcher picks</span>
          <span className="cap">
            bills that moved and scored highest on a cheap check, daily; worth a look, not a verdict
          </span>
        </div>
        <div className="picks">
          {index.watch.length ? (
            <div className="pickgroups">
              {groupPicks(index.watch.slice(0, 12)).map(([kind, list]) => (
                <div className="card" key={kind}>
                  <h2>{KIND[kind]?.[0] ?? kind.replace("_", " ")}</h2>
                  <div className="row-meta">
                    {KIND[kind]?.[1]} Seen {stamp(list[0]!.seenAt).split(",")[0]}.
                  </div>
                  <ul className="rows">
                    {list.map((w) => (
                      <li key={`${w.billId}-${w.seenAt}`} className="pick">
                        <span>
                          <b className="mono">{w.display}</b> {w.title}
                          <PickHook entry={index.bills.find((b) => b.id === w.billId)} />
                          {w.sponsorParty && <span className="row-meta"> · {PARTY[w.sponsorParty]} sponsor</span>}
                          {w.reason && <div className="row-meta">{w.reason}</div>}
                        </span>
                        {w.file ? (
                          <a className="src" href={billHref(w.billId)} onClick={onLink}>
                            X-ray this bill
                          </a>
                        ) : (
                          <a className="src" href={w.url} target="_blank" rel="noopener">
                            Read on congress.gov
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">The daily watcher hasn’t flagged a bill yet. Its picks show up here.</div>
          )}
        </div>

        <div className="section-h" id="read">
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
              next to every label, never just a verdict. {testable} of {index.bills.length} bills here had enough news
              and a late flag to test at all.
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

const KIND: Record<string, [string, string]> = {
  law: ["Became law", "Signed into law, and lobbyists named it."],
  cbo: ["Got a CBO estimate", "The Congressional Budget Office published a cost estimate."],
  look: ["Worth a look", "Moved and scored high on a cheap check; a lead, not a verdict."],
};

const kindOf = (w: BundleIndex["watch"][number]) =>
  w.reason?.startsWith("Became law") ? "law" : w.reason?.startsWith("Got a CBO") ? "cbo" : "look";

function groupPicks(picks: BundleIndex["watch"]) {
  const out = new Map<string, BundleIndex["watch"]>();
  for (const w of picks) out.set(kindOf(w), [...(out.get(kindOf(w)) ?? []), w]);
  return [...out];
}

function bigHook(b: Entry): { num: string; label: string; used: string } | null {
  const s = b.stats;
  if (!s) return null;
  if (s.late && s.late >= 10) return { num: String(s.late), label: "sections added late", used: "late" };
  if (s.deficitMusd != null && Math.abs(s.deficitMusd) >= 1000)
    return { num: musd(s.deficitMusd), label: "deficit, per CBO", used: "deficit" };
  if (s.late)
    return { num: String(s.late), label: s.late === 1 ? "section added late" : "sections added late", used: "late" };
  return { num: s.lobbyingReports.toLocaleString("en-US"), label: "lobbying reports", used: "lobbying" };
}

function hook(b: Entry, used: string | undefined): string {
  const s = b.stats;
  if (!s) return "";
  const parts = [
    s.deficitMusd != null && used !== "deficit" ? `CBO says it ${deficitWords(s.deficitMusd)}` : null,
    s.late && used !== "late" ? `${s.late} ${s.late === 1 ? "section was" : "sections were"} added late` : null,
    s.lobbyingReports && used !== "lobbying"
      ? `${s.lobbyingReports.toLocaleString("en-US")} lobbying reports name it`
      : null,
  ].filter(Boolean);
  return parts.length ? `${parts.join("; ")}.` : "";
}

function buriedLine(s: NonNullable<Entry["stats"]>) {
  if (!s.buriedTest.tested) return `Buried candidates: not tested (${s.buriedTest.why}).`;
  if (!s.buriedTest.dollarsMeasured) return "Stakes can't be measured: CBO gave no section its own dollar figure.";
  if (s.buried > 0)
    return `Buried candidates: ${s.buried} of ${s.buriedTest.bigStakes} big-stakes ${s.buriedTest.bigStakes === 1 ? "section" : "sections"}.`;
  if (s.buriedTest.bigStakes === 0) return "No section has big stakes.";
  return `Buried candidates: 0 of ${s.buriedTest.bigStakes} big-stakes ${s.buriedTest.bigStakes === 1 ? "section" : "sections"}${s.buriedTest.why ? ` (${s.buriedTest.why})` : ""}.`;
}

function PickHook({ entry }: { entry?: Entry }) {
  const num = entry && bigHook(entry);
  if (!num) return null;
  return (
    <div className="ph">
      <b>{num.num}</b> {num.label}
    </div>
  );
}

function BillCard({ b, big = false }: { b: Entry; big?: boolean }) {
  const s = b.stats;
  const party = s?.tally?.byParty;
  const num = bigHook(b);
  const meta = [b.display, b.law].filter(Boolean).join(" · ");
  return (
    <a
      className={`billcard${big ? " big" : ""}`}
      href={billHref(b.id)}
      onClick={onLink}
      onPointerEnter={() => prefetchBundle(b.id)}
      onFocus={() => prefetchBundle(b.id)}
    >
      <div className="fp">
        <Fingerprint kinds={s?.fingerprint ?? ""} label={b.display} />
        {big && <small className="figkey">Ring: one tick per section. Gold is headline, red is buried.</small>}
      </div>
      <div className="bc">
        <div className="bc-a">
          {b.id === START_HERE && <span className="badge-start">Start with this one</span>}
          <div className="cap meta">{meta}</div>
          {num && (
            <div className="bignum">
              <b>{num.num}</b> <span>{num.label}</span>
            </div>
          )}
          <h3>{b.shortTitle ?? b.title}</h3>
        </div>
        <div className="bc-b">
          {s && hook(b, num?.used) && <div className="hook">{hook(b, num?.used)}</div>}
          {s && (
            <>
              <div className="tags">
                {b.sponsorParty && (
                  <span title="Sponsor party is a label, not who voted for the bill">{b.sponsorParty} sponsor</span>
                )}
                {b.congress ? (
                  <span title={CONGRESS_TAG[b.congress]}>
                    {CONGRESS_TAG[b.congress]?.split(" · ")[0] ?? `${b.congress}th Congress`}
                  </span>
                ) : null}
                {s.vehicle && <span title="A shell bill reused to carry other legislation">vehicle bill</span>}
                {b.latestActionOn && <span>{day(b.latestActionOn)}</span>}
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
            </>
          )}
        </div>
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
