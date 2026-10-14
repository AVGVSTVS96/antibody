import type { BillModel, SectionView } from "../lib/model.ts";
import { onLink, sectionHref } from "../lib/router.ts";
import { Stat, StatRow } from "../ui/primitives.tsx";
import { Src } from "../ui/receipt.tsx";
import { deficitVerb, signed } from "./format.ts";
import { type Entry, exhibitOf, lineageOf, storyOf } from "./rules.ts";

const cite = (ids: readonly string[]) => (ids.length ? <Src ids={ids} /> : null);

const KIND = { headline: "HEADLINE", buried: "QUIET AND COSTLY", normal: "", unscored: "" } as const;

function Cost({ v }: { v: SectionView }) {
  if (v.dollarsMusd == null) return <Stat value="—" label="No CBO figure for this section" />;
  const period = v.s.dollars.find((d) => d.estimateId === v.figure?.estimateId && d.baseline === "current-law")?.period;
  const even = v.figure?.split === "even_split";
  return (
    <Stat
      value={signed(v.dollarsMusd)}
      label={
        <>
          CBO: {deficitVerb(v.dollarsMusd)}
          {period && `, ${period.replace("-", "–")}`}
          {even && " · even split, an inference"} {cite(v.figure?.claims ?? [])}
        </>
      }
    />
  );
}

function Filled({ model, v, phone }: { model: BillModel; v: SectionView; phone: boolean }) {
  const lineage = lineageOf(model, v);
  const read = model.b.attention.sample?.relevant ?? model.b.attention.articles;
  const hits = v.s.attention?.hits;
  const lobbyClaims = model.b.edges
    .filter((e) => e.kind === "lobbied" && e.dst === `section:${v.s.id}`)
    .flatMap((e) => e.claims);
  const href = sectionHref(model.b.bill.id, model.sectionSlug(v));
  return (
    <>
      <div className="ex-top">
        <p className="ex-kicker">
          EXHIBIT · {model.b.bill.display} · {model.secLabel(v)}
        </p>
        <p className="ex-kind">{KIND[v.kind]}</p>
      </div>
      <h3 className="ex-title">
        <a className="plain" href={href} onClick={onLink}>
          {v.s.heading}
        </a>
      </h3>
      <StatRow size="md">
        <Cost v={v} />
        <Stat
          value={hits ?? "—"}
          label={
            hits == null ? (
              "Coverage not measured"
            ) : (
              <>
                of {read.toLocaleString("en-US")} articles read mention it{" "}
                {cite(v.s.attention ? [v.s.attention.claim] : [])}
              </>
            )
          }
        />
        <Stat
          value={v.lobbied}
          label={
            <>
              Lobbying {v.lobbied === 1 ? "report names" : "reports name"} it {cite(lobbyClaims)}
            </>
          }
        />
      </StatRow>
      {lineage && (
        <p className="ex-lineage">
          {lineage.text} {cite(lineage.claims)}
        </p>
      )}
      {phone && (
        <a className="ex-go" href={href} onClick={onLink}>
          OPEN THIS SECTION <span aria-hidden="true">→</span>
        </a>
      )}
    </>
  );
}

function NothingBuried({ bill }: { bill: Entry }) {
  const story = storyOf(bill);
  return (
    <>
      <p className="ex-kicker">{bill.display} · NO EXHIBIT</p>
      <h3 className="ex-title">{story.lead}</h3>
      <p className="ex-lineage">{story.body}</p>
    </>
  );
}

/** The card beside the headline: one quiet and costly section picked by `exhibitOf`, with its three numbers and when it appeared. */
export function Exhibit({ bill, model, phone }: { bill: Entry; model: BillModel | null; phone: boolean }) {
  const v = model && exhibitOf(model);
  return (
    <aside className="exhibit" aria-label="Exhibit" aria-busy={!model}>
      {!model ? (
        <>
          <div className="ex-top">
            <p className="ex-kicker">EXHIBIT · {bill.display}</p>
          </div>
          <div className="bone ex-bone" />
        </>
      ) : v ? (
        <Filled model={model} v={v} phone={phone} />
      ) : (
        <NothingBuried bill={bill} />
      )}
    </aside>
  );
}
