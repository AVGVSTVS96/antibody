import type { BundleIndex } from "@antibody/core";
import { RULES_URL } from "../lib/format.ts";
import { billHref, onLink, storyHref } from "../lib/router.ts";
import { MiniTape } from "../ui/MiniTape.tsx";
import { Kicker } from "../ui/primitives.tsx";
import { type Entry, storyOf } from "./rules.ts";

const LEAD = { quiet: "THE STORY THE HEADLINES MISSED", other: "THE FEATURED X-RAY" } as const;

/** Phone only (the front page of the C boards): the featured bill's story in three lines, and the way into its six chapters. */
export function Lede({ bill }: { bill: Entry }) {
  const story = storyOf(bill);
  const quiet = bill.stats.buried > 0;
  return (
    <section className="wrap lede" aria-label="The story">
      <div className="lede-top">
        <Kicker className="lede-tag">{quiet ? LEAD.quiet : LEAD.other}</Kicker>
        <span>{bill.display}</span>
      </div>
      <h2>
        {story.lead}
        {story.mark && (
          <>
            <br />
            <span className="hl">{story.mark}</span>
          </>
        )}
      </h2>
      <p>{story.body}</p>
      <a className="lede-go" href={storyHref(bill.id)} onClick={onLink}>
        <span>
          <b className="lede-go-title">Read the story</b>
          <i className="lede-go-sub">6 chapters</i>
        </span>
        <span aria-hidden="true">→</span>
      </a>
    </section>
  );
}

function Card({ bill }: { bill: Entry }) {
  const s = bill.stats;
  const story = storyOf(bill);
  return (
    <article className="card">
      <div className="card-top">
        <span>{bill.shortTitle ?? bill.title}</span>
        <span>{bill.display}</span>
      </div>
      <h3>
        {story.lead}
        {story.mark && (
          <>
            {" "}
            <span className="hl">{story.mark}</span>
          </>
        )}
      </h3>
      <p>{story.body}</p>
      <MiniTape fingerprint={s.fingerprint} label={bill.shortTitle ?? bill.title} height={24} />
      <div className="card-foot">
        <span>
          {s.sections.toLocaleString("en-US")} sections ·{" "}
          {s.buriedTest.tested ? `${s.buried} quiet + costly` : "test did not run"}
        </span>
        <a href={billHref(bill.id)} onClick={onLink}>
          Read <span aria-hidden="true">→</span>
        </a>
      </div>
    </article>
  );
}

/** Phone only: the next bills in library order, each told by the same template as the featured one. */
export function Also({ bills }: { bills: Entry[] }) {
  if (!bills.length) return null;
  return (
    <section className="wrap also" aria-labelledby="also-h">
      <Kicker as="h2" className="front-rule">
        <span id="also-h">ALSO ON THE FRONT PAGE</span>
      </Kicker>
      {bills.map((b) => (
        <Card key={b.id} bill={b} />
      ))}
    </section>
  );
}

const STAMP = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** Phone only: the daily watcher's picks, from the index; the ones with no x-ray yet link out to congress.gov. */
export function JustIn({ picks }: { picks: BundleIndex["watch"] }) {
  if (!picks.length) return null;
  return (
    <section className="just" aria-labelledby="just-h">
      <Kicker as="h2" className="front-rule">
        <span id="just-h">JUST IN FROM CONGRESS</span>
      </Kicker>
      <ul>
        {picks.map((p) => {
          const link = p.file
            ? { href: billHref(p.billId), onClick: onLink }
            : { href: p.url, target: "_blank", rel: "noopener noreferrer" };
          return (
            <li key={p.billId}>
              <b className="just-key">{p.display}</b>
              <div>
                <a className="plain" {...link}>
                  {p.title}
                  {!p.file && <span aria-hidden="true"> ↗</span>}
                </a>
                <p className="just-why">
                  {p.reason ?? "Flagged by the daily watcher"} · {STAMP.format(new Date(p.seenAt))}
                  {!p.file && " · not x-rayed yet"}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function RulesNote() {
  return (
    <aside className="rules-note">
      <b className="rules-note-title">Same rules for every bill and every party.</b>
      <p>
        Every number links its public source. Inferences say so.{" "}
        <a href={RULES_URL} target="_blank" rel="noopener noreferrer">
          Read the rules ↗
        </a>
      </p>
    </aside>
  );
}
