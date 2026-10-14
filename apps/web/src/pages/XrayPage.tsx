import { memberHref, onLink, sectionHref, storyHref } from "../lib/router.ts";
import { useModel } from "../ui/BillGate.tsx";
import { Kicker, Wrap } from "../ui/primitives.tsx";
import { Src } from "../ui/receipt.tsx";

export default function XrayPage() {
  const m = useModel();
  const { bill } = m.b;
  const quiet = m.buried[0] ?? m.headline[0];
  return (
    <Wrap className="page">
      <Kicker>STEP 2 · X-RAY · {bill.congress}TH CONGRESS</Kicker>
      <h1>{bill.shortTitle ?? bill.title}</h1>
      <p className="lead">
        {bill.display} <Src ids={`bills/${bill.id}`} />
      </p>
      <p>
        <a href={storyHref(bill.id)} onClick={onLink}>
          The story
        </a>
        {quiet && (
          <>
            {" · "}
            <a href={sectionHref(bill.id, m.sectionSlug(quiet))} onClick={onLink}>
              Follow {m.secLabel(quiet)}
            </a>
          </>
        )}
        {m.sponsor && (
          <>
            {" · "}
            <a href={memberHref(bill.id, m.sponsor.props.bioguide)} onClick={onLink}>
              {m.sponsor.label}
            </a>
          </>
        )}
      </p>
    </Wrap>
  );
}
