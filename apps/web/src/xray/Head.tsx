import { isAppropriations } from "@antibody/core";
import { useState } from "react";
import { day } from "../lib/format.ts";
import type { BillModel } from "../lib/model.ts";
import { memberHref, onLink, storyHref } from "../lib/router.ts";
import { Kicker } from "../ui/primitives.tsx";
import { Src } from "../ui/receipt.tsx";
import { type Baseline, baselines, type Passage, passageText, signed } from "./derive.ts";

const NAMES = { "current-law": "CBO current law", "current-policy": "CBO current policy" } as const;

const dash = (period: string) => period.replace("-", "–");

function Toggle({
  all,
  which,
  onPick,
}: {
  all: Baseline[];
  which: Baseline["baseline"];
  onPick: (b: Baseline["baseline"]) => void;
}) {
  return (
    <fieldset className="x-toggle">
      <legend className="x-sr">CBO baseline</legend>
      {(["current-law", "current-policy"] as const).map((b) => {
        const found = all.find((x) => x.baseline === b);
        return (
          <button
            key={b}
            type="button"
            aria-pressed={which === b}
            disabled={!found}
            title={found ? undefined : `CBO published no ${b} estimate for this bill`}
            onClick={() => onPick(b)}
          >
            {found?.estimate.baselineLabel ?? `${NAMES[b]}: none published`}
          </button>
        );
      })}
    </fieldset>
  );
}

function Cost({ m, all }: { m: BillModel; all: Baseline[] }) {
  const [which, setWhich] = useState<Baseline["baseline"]>(all[0]?.baseline ?? "current-law");
  const shown = all.find((b) => b.baseline === which);
  const other = all.find((b) => b.baseline !== which);
  const sectionBasis = m.sections.find((v) => v.figure)?.figure?.estimate.baselineLabel;
  if (!shown)
    return (
      <div className="x-cost">
        <b className="x-cost-none">NO WHOLE-BILL FIGURE</b>
        <p>
          {m.b.dollars.estimates.length
            ? "CBO published an estimate for this bill, but we did not read a whole-bill deficit figure from it."
            : "We found no CBO cost estimate for this bill."}
        </p>
        {m.b.dollars.estimates[0] && (
          <p className="x-chips">
            <Src ids={m.b.dollars.estimates[0].claim} label="CBO ESTIMATE" />
          </p>
        )}
      </div>
    );
  const { dollar, estimate } = shown;
  const verdict =
    dollar.amountMusd > 0
      ? "ADDED TO THE DEFICIT"
      : dollar.amountMusd < 0
        ? "CUT FROM THE DEFICIT"
        : "NO NET EFFECT ON THE DEFICIT";
  return (
    <div className="x-cost">
      <Toggle all={all} which={which} onPick={setWhich} />
      <div className="x-cost-fig">
        <strong>{signed(dollar.amountMusd)}</strong>
        <span>
          {verdict}, {dash(dollar.period)}
        </span>
      </div>
      <p>
        Measured against the {estimate.baselineLabel}. CBO's description of the text it scored: “
        {estimate.versionScored}”.
        {other &&
          ` On the ${other.estimate.baselineLabel} CBO's figure is ${signed(other.dollar.amountMusd)}, for “${other.estimate.versionScored}”. Both are CBO's.`}
        {isAppropriations(m.b) &&
          " Direct spending and revenue only: the bill's discretionary appropriations are not in this figure."}{" "}
        {sectionBasis
          ? `Every section figure on this page is on the ${sectionBasis}, whichever baseline is chosen here.`
          : "CBO gave no per-section dollars for this bill, so no section carries a cost."}
      </p>
      <p className="x-chips">
        <Src ids={[dollar.claim, estimate.claim]} label={`CBO ESTIMATE, ${day(estimate.publishedOn).toUpperCase()}`} />
        <Src ids={m.b.bill.claims} label="BILL ON CONGRESS.GOV" />
      </p>
    </div>
  );
}

export function Head({ m, passes }: { m: BillModel; passes: Passage[] }) {
  const { bill } = m.b;
  const stage = bill.law
    ? `BECAME ${bill.law}${bill.lawOn ? ` ON ${day(bill.lawOn).toUpperCase()}` : ""}`
    : (bill.latestAction ?? "").toUpperCase();
  return (
    <header className="x-head wrap">
      <div className="x-head-text">
        <Kicker>
          STEP 2 · X-RAY · {bill.congress}TH CONGRESS · {stage}
        </Kicker>
        <h1>{bill.shortTitle ?? bill.title}</h1>
        <p className="x-lead">
          {bill.shortTitle && `${bill.title} `}
          {m.sponsor && (
            <>
              Sponsor{" "}
              <a href={memberHref(bill.id, m.sponsor.props.bioguide)} onClick={onLink}>
                {m.sponsor.label}
              </a>
              .{" "}
            </>
          )}
          {passes.length > 0 && (
            <>
              {passageText(passes)} <Src ids={passes.map((p) => p.claim)} label="ROLL CALLS" />
            </>
          )}
        </p>
        {bill.vehicle && <p className="x-lead x-vehicle">{bill.vehicle}</p>}
        <p className="x-chips">
          <a href={storyHref(bill.id)} onClick={onLink}>
            THE STORY IN 6 CHAPTERS →
          </a>
        </p>
      </div>
      <Cost key={bill.id} m={m} all={baselines(m.b)} />
    </header>
  );
}
