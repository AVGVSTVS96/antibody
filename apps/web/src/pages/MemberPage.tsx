import { type BillRoute, billHref, onLink } from "../lib/router.ts";
import { useModel } from "../ui/BillGate.tsx";
import { NotFound } from "../ui/NotFound.tsx";
import { Kicker, Wrap } from "../ui/primitives.tsx";
import { Src } from "../ui/receipt.tsx";

export default function MemberPage({ route }: { route: Extract<BillRoute, { page: "member" }> }) {
  const m = useModel();
  const member = m.memberById.get(`member:${route.bioguide}`);
  if (!member) return <NotFound title="That member is not in this bill's data." />;
  return (
    <Wrap className="page">
      <Kicker>STEP 4 · A MEMBER · {m.b.bill.display}</Kicker>
      <h1>{member.node.label}</h1>
      <p className="lead">
        <Src ids={member.node.claims} />
      </p>
      <p>
        <a href={billHref(m.b.bill.id)} onClick={onLink}>
          The x-ray
        </a>
      </p>
    </Wrap>
  );
}
