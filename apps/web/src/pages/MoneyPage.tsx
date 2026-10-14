import { type BillRoute, billHref, onLink } from "../lib/router.ts";
import { useModel } from "../ui/BillGate.tsx";
import { NotFound } from "../ui/NotFound.tsx";
import { Kicker, Wrap } from "../ui/primitives.tsx";
import { Src } from "../ui/receipt.tsx";

export default function MoneyPage({ route }: { route: Extract<BillRoute, { page: "money" }> }) {
  const m = useModel();
  const v = m.sectionBySlug(route.section);
  if (!v) return <NotFound title="That section is not in this bill." />;
  return (
    <Wrap className="page">
      <Kicker>
        STEP 3 · FOLLOW THE MONEY · {m.b.bill.display} › {m.secLabel(v)}
      </Kicker>
      <h1>{v.s.heading}</h1>
      <p className="lead">
        <Src ids={`sections/${v.s.id}`} />
        {v.s.score && (
          <>
            {" "}
            <Src ids={`section_scores/${m.b.bill.id}:${v.s.id}`} label="SCORE" />
          </>
        )}
      </p>
      <p>
        <a href={billHref(m.b.bill.id)} onClick={onLink}>
          The x-ray
        </a>
      </p>
    </Wrap>
  );
}
