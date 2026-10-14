import { type BillRoute, billHref, onLink } from "../lib/router.ts";
import { useModel } from "../ui/BillGate.tsx";
import { Kicker, Wrap } from "../ui/primitives.tsx";
import { Src } from "../ui/receipt.tsx";

export default function StoryPage({ route }: { route: Extract<BillRoute, { page: "story" }> }) {
  const { bill } = useModel().b;
  return (
    <Wrap className="page">
      <Kicker>THE STORY · {route.chapter ? `CHAPTER ${route.chapter}` : "FRONT PAGE"}</Kicker>
      <h1>{bill.shortTitle ?? bill.title}</h1>
      <p className="lead">
        {bill.display} <Src ids={`bills/${bill.id}`} />
      </p>
      <p>
        <a href={billHref(bill.id)} onClick={onLink}>
          The x-ray
        </a>
      </p>
    </Wrap>
  );
}
