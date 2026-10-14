import type { NodeOf } from "@antibody/core";
import { count } from "../lib/format.ts";
import { memberShort } from "../lib/model.ts";
import { memberHref, onLink } from "../lib/router.ts";
import type { Ranked } from "../lib/trades.ts";
import { useModel } from "../ui/BillGate.tsx";

/** "Lisa C. McClain": the name without the title and without the party and state. */
export const memberName = (n: NodeOf<"member">) => n.label.replace(/^(Sen|Rep)\.\s+/, "").replace(/\s*\(.*\)$/, "");

/** "Rep. McClain R-MI": how every member is named in a list. */
export function chipName(n: NodeOf<"member">) {
  const [last] = memberShort(n).split(" ");
  return `${n.label.slice(0, 4)} ${last} ${n.props.party}-${n.props.state}`;
}

/** Members as link chips, in the order given, with how many of the companies each traded. `current` is marked. */
export function MemberChips({ ranked, current }: { ranked: readonly Ranked[]; current?: string }) {
  const m = useModel();
  return (
    <ul className="chips">
      {ranked.map((r) => (
        <li key={r.member.node.id}>
          <a
            className="chip"
            href={memberHref(m.b.bill.id, r.member.node.props.bioguide)}
            onClick={onLink}
            aria-current={r.member.node.id === current ? "page" : undefined}
            title={`${count(r.companies, "company", "companies")}, ${count(r.trades, "trade")}`}
          >
            {chipName(r.member.node)} <span>{r.companies}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
