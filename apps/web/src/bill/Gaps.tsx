import type { BillModel } from "../lib/model.ts";
import { Src } from "../ui/claims.tsx";

type Kind = BillModel["b"]["gaps"][number]["kind"];

export function Gaps({ m, kinds }: { m: BillModel; kinds: Kind[] }) {
  const gaps = m.b.gaps.filter((g) => kinds.includes(g.kind));
  if (!gaps.length) return null;
  return (
    <ul className="gaps">
      {gaps.map((g) => (
        <li key={g.id}>
          {g.text} {g.claim && <Src id={g.claim} />}
        </li>
      ))}
    </ul>
  );
}
