import { useState } from "react";
import { loadBundle } from "../lib/data.ts";
import { day } from "../lib/format.ts";
import { modelOf } from "../lib/model.ts";
import { billHref, onLink } from "../lib/router.ts";
import { buildTape } from "../lib/tape.ts";
import { MiniTape } from "../ui/MiniTape.tsx";
import { Section } from "../ui/primitives.tsx";
import { sectionTarget } from "./FeaturedTape.tsx";
import { deficitCell } from "./format.ts";
import type { Entry } from "./rules.ts";

const SHOWN = { desktop: 6, phone: 2 };

const firstQuiet = new Map<string, string>();

/** Looks ahead while the pointer or focus is on a row, so a click can land on the bill's first quiet and costly mark. */
function warm(id: string) {
  if (firstQuiet.has(id)) return;
  loadBundle(id)
    .then((b) => {
      const row = b && buildTape(modelOf(b)).rows.find((r) => r.kind === "quiet");
      if (row) firstQuiet.set(id, sectionTarget(id, row).replace(/^[^#]*/, ""));
    })
    .catch(() => {});
}

const count = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));

function Row({ bill }: { bill: Entry }) {
  const s = bill.stats;
  const deficit = deficitCell(s);
  const meta = [
    bill.display,
    bill.law,
    s.vehicle ? "vehicle bill" : bill.latestActionOn && day(bill.latestActionOn),
    bill.sponsorParty && `${bill.sponsorParty} sponsor`,
  ].filter(Boolean);
  return (
    <li className="lib-row" onPointerEnter={() => warm(bill.id)} onFocus={() => warm(bill.id)}>
      <div className="lib-tape">
        <MiniTape fingerprint={s.fingerprint} label={bill.shortTitle ?? bill.title} />
      </div>
      <div className="lib-name">
        <h3>
          <a
            className="plain"
            href={billHref(bill.id)}
            onClick={(e) => {
              const at = firstQuiet.get(bill.id);
              if (at) e.currentTarget.hash = at;
              onLink(e);
            }}
          >
            {bill.shortTitle ?? bill.title}
          </a>
        </h3>
        <p>
          {meta.join(" · ")}
          {s.vehicle && ` · ${s.sections.toLocaleString("en-US")} sections`}
        </p>
      </div>
      <div className="lib-cells">
        <p className="lib-n" data-col="loud">
          <b>{s.mentions ? s.headline : "—"}</b>
          <i>loud</i>
        </p>
        <p className="lib-n" data-col="quiet">
          <b data-quiet={(s.buriedTest.tested && s.buried > 0) || undefined}>{s.buriedTest.tested ? s.buried : "—"}</b>
          <i>quiet</i>
        </p>
        <p className="lib-n" data-col="late">
          <b>{count(s.late)}</b>
          <i>late</i>
        </p>
        <p className="lib-n" data-col="deficit" data-none={deficit.value == null || undefined}>
          <b>{deficit.value ?? deficit.note}</b>
          {deficit.value && <i>{deficit.note}</i>}
        </p>
        <p className="lib-n" data-col="lobbying">
          <b>{count(s.lobbyingReports)}</b>
          <i>lobbying</i>
        </p>
      </div>
    </li>
  );
}

/** Every x-rayed bill in `libraryOf` order, each with its own tape under the same key as the featured one. */
export function Library({ bills, phone }: { bills: Entry[]; phone: boolean }) {
  const [all, setAll] = useState(false);
  const limit = phone ? SHOWN.phone : SHOWN.desktop;
  const shown = all ? bills : bills.slice(0, limit);
  const more = bills.length - shown.length;
  return (
    <Section
      id="library"
      className="land-lib"
      kicker="STEP 1 · OR PICK ONE THAT'S ALREADY X-RAYED"
      title="The library"
      aside={
        <p className="land-note">
          Every bill's tape uses the same key as above · Sponsor party is not who voted for it
        </p>
      }
    >
      <div className="lib-table">
        <ul className="lib-head" aria-hidden="true">
          <li>Tape · bill order</li>
          <li>Bill</li>
          <li>Loud</li>
          <li>Quiet</li>
          <li>Late</li>
          <li>CBO deficit</li>
          <li>Lobbying</li>
        </ul>
        <ul className="lib-rows">
          {shown.map((b) => (
            <Row key={b.id} bill={b} />
          ))}
        </ul>
      </div>
      <div className="lib-foot">
        {(more > 0 || all) && bills.length > limit ? (
          <button type="button" className="lib-more" aria-expanded={all} onClick={() => setAll(!all)}>
            {all ? "− Show fewer" : `+ ${more} more x-rayed ${more === 1 ? "bill" : "bills"}`}
          </button>
        ) : (
          <span />
        )}
        <p className="land-note">
          A gray bar with no marks means nothing flagged, not nothing there · "—" means the test did not run or the data
          is not available for this bill
        </p>
      </div>
    </Section>
  );
}
