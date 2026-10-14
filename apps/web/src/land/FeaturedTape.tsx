import type { BillModel } from "../lib/model.ts";
import { billHref, navigate } from "../lib/router.ts";
import { geometry, type Tape as TapeData, type TapeRow } from "../lib/tape.ts";
import { MiniTape } from "../ui/MiniTape.tsx";
import { Legend, type LegendMark, Stat, StatRow } from "../ui/primitives.tsx";
import { Src } from "../ui/receipt.tsx";
import { Tape } from "../ui/Tape.tsx";
import { deficitVerb, signed } from "./format.ts";
import type { Entry } from "./rules.ts";

export const sectionTarget = (id: string, row: Pick<TapeRow, "routeId">) => `${billHref(id)}#section-${row.routeId}`;

function Head({ bill, phone }: { bill: Entry; phone: boolean }) {
  const s = bill.stats;
  const noFigure = [...s.tape.dollars].filter((c) => c === ".").length;
  const flat = noFigure === s.sections;
  const marks: LegendMark[] = ["loud", "quiet", "other"];
  if (s.tape.evenSplit.length) marks.push("split");
  if (noFigure && !flat) marks.push("nofigure");
  const caption = [
    "THE TAPE",
    bill.display,
    `${s.sections.toLocaleString("en-US")} SECTIONS`,
    !phone && "BILL ORDER",
    flat ? "HEIGHT SHOWS KIND, NOT COST" : "UP ADDS, DOWN CUTS (LOG SCALE)",
    s.late != null && !phone && "TICKS = ADDED LATE",
    phone && "DRAG TO SCRUB",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="land-head">
      <div>
        <p className="kicker">{caption}</p>
        <h2>Every mark is a section. Yellow: big stakes, little coverage.</h2>
      </div>
      <Legend marks={marks} labels={{ nofigure: `NO CBO FIGURE (${noFigure})` }} />
    </div>
  );
}

/** The featured bill's tape: the mini tape from the index until the bundle arrives, then the full one drawing itself in. */
export function FeaturedTape({ bill, tape, phone }: { bill: Entry; tape: TapeData | null; phone: boolean }) {
  const s = bill.stats;
  const flat = !s.tape.dollars.replace(/\./g, "");
  const height = geometry(phone, flat).height;
  const below = phone ? 60 + (s.quietRun ? 70 : 0) : 30 + (s.quietRun ? 120 : 0);
  return (
    <div className="land-tape" data-run={!!s.quietRun || undefined} data-phone={phone || undefined}>
      <Head bill={bill} phone={phone} />
      {tape ? (
        <Tape tape={tape} legend={false} note onSelect={(row) => navigate(sectionTarget(bill.id, row))} />
      ) : (
        <div className="land-hold" style={{ height: height + below }}>
          <MiniTape fingerprint={s.fingerprint} height={height} label={bill.display} />
        </div>
      )}
    </div>
  );
}

export function FeaturedStats({ bill, model, tape }: { bill: Entry; model: BillModel | null; tape: TapeData | null }) {
  const s = bill.stats;
  const rows = tape?.rows;
  const none = rows?.filter((r) => r.articles === 0) ?? [];
  const unmeasured = rows?.filter((r) => r.articles == null).length ?? 0;
  const claims = (kind: "headline" | "quiet") =>
    rows?.filter((r) => r.kind === kind).flatMap((r) => (r.view.s.score ? [r.view.s.score.claim] : [])) ?? [];
  const lateVersions = model
    ? [...new Set(rows?.filter((r) => r.late).map((r) => r.view.s.firstVersion))].flatMap(
        (code) => model.versions.find((v) => v.code === code)?.claim ?? [],
      )
    : [];
  const cite = (ids: readonly string[]) => (ids.length ? <Src ids={ids} /> : null);
  const deficit = s.deficitMusd;
  return (
    <StatRow>
      {deficit == null ? (
        <Stat value="—" label="NO CBO TOTAL FOR THIS BILL" />
      ) : (
        <Stat
          value={signed(deficit)}
          label={
            <>
              CBO current-law total: {deficitVerb(deficit)}
              {s.deficitDirectOnly && ", direct spending only"}{" "}
              {cite(
                model?.b.dollars.wholeBill.flatMap((d) =>
                  d.measure === "deficit" && d.amountMusd === deficit ? [d.claim] : [],
                ) ?? [],
              )}
            </>
          }
        />
      )}
      <Stat
        value={s.mentions ? s.headline : "—"}
        label={
          s.mentions ? (
            <>Headline sections, the top tenth by news coverage {cite(claims("headline"))}</>
          ) : (
            "Too few articles to rank sections"
          )
        }
      />
      <Stat
        tone="quiet"
        value={s.buriedTest.tested ? s.buried : "—"}
        label={
          s.buriedTest.tested ? (
            <>Quiet and costly: big stakes, late or off-topic, little coverage {cite(claims("quiet"))}</>
          ) : (
            "The quiet-and-costly test could not run on this bill"
          )
        }
      />
      <Stat
        value={s.late ?? "—"}
        label={
          s.late == null ? (
            "Added-late flags are unavailable for this bill"
          ) : (
            <>Sections first appeared after a chamber had passed the bill {cite(lateVersions)}</>
          )
        }
      />
      <Stat
        value={s.articlesRead == null ? "—" : rows ? none.length : <span className="bone land-bone" />}
        label={
          s.articlesRead == null ? (
            "No articles read for this bill"
          ) : (
            <>
              of {s.sections.toLocaleString("en-US")} sections were in none of the{" "}
              {s.articlesRead.toLocaleString("en-US")} articles read
              {unmeasured ? ` (${unmeasured} more ${unmeasured === 1 ? "has" : "have"} no coverage record)` : ""}{" "}
              {cite(none.flatMap((r) => (r.view.s.attention ? [r.view.s.attention.claim] : [])))}
            </>
          )
        }
      />
    </StatRow>
  );
}
