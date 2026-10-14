import type { Featured } from "@antibody/core";
import { onLink, sectionHref } from "../lib/router.ts";
import { Stat, StatRow } from "../ui/primitives.tsx";
import { Src } from "../ui/receipt.tsx";
import { deficitVerb, signed } from "./format.ts";
import { type Entry, lineageOf, storyOf } from "./rules.ts";

const cite = (ids: readonly (string | null)[]) => {
  const found = ids.filter((id): id is string => !!id);
  return found.length ? <Src ids={found} /> : null;
};

function Filled({
  bill,
  featured,
  ex,
  phone,
}: {
  bill: Entry;
  featured: Featured;
  ex: NonNullable<Featured["exhibit"]>;
  phone: boolean;
}) {
  const row = featured.rows[ex.row]!;
  const lineage = lineageOf(featured);
  const href = sectionHref(bill.id, row.slug);
  return (
    <>
      <div className="ex-top">
        <p className="ex-kicker">
          EXHIBIT · {bill.display} · §{row.num}
        </p>
        <p className="ex-kind">QUIET AND COSTLY</p>
      </div>
      <h3 className="ex-title">
        <a className="plain" href={href} onClick={onLink}>
          {row.heading}
        </a>
      </h3>
      <StatRow size="md">
        {row.musd == null ? (
          <Stat value="—" label="No CBO figure for this section" />
        ) : (
          <Stat
            value={signed(row.musd)}
            label={
              <>
                CBO: {deficitVerb(row.musd)}
                {ex.period && `, ${ex.period.replace("-", "–")}`}
                {row.evenSplit && " · even split, an inference"} {cite(ex.figureClaims)}
              </>
            }
          />
        )}
        <Stat
          value={row.articles ?? "—"}
          label={
            row.articles == null ? (
              "Coverage not measured"
            ) : (
              <>
                of {featured.read.toLocaleString("en-US")} articles read mention it {cite([row.attentionClaim])}
              </>
            )
          }
        />
        <Stat
          value={row.named}
          label={
            <>
              Lobbying {row.named === 1 ? "report names" : "reports name"} it {cite([row.scoreClaim])}
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

function NoExhibit({ bill }: { bill: Entry }) {
  const story = storyOf(bill);
  return (
    <>
      <p className="ex-kicker">{bill.display} · NO EXHIBIT</p>
      <h3 className="ex-title">{story.lead}</h3>
      <p className="ex-lineage">{story.body}</p>
    </>
  );
}

/** The card beside the headline: the featured bill's quiet and costly section picked by the landing-exhibit rule, with its three numbers and when it appeared. */
export function Exhibit({ bill, featured, phone }: { bill: Entry; featured: Featured; phone: boolean }) {
  const ex = featured.exhibit;
  return (
    <aside className="exhibit" aria-label="Exhibit">
      {ex ? <Filled bill={bill} featured={featured} ex={ex} phone={phone} /> : <NoExhibit bill={bill} />}
    </aside>
  );
}
