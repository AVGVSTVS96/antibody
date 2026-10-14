import type { NodeOf } from "@antibody/core";
import { count, day, ordinal } from "../lib/format.ts";
import { memberShort } from "../lib/model.ts";
import { memberHref, onLink } from "../lib/router.ts";
import type { Ranked } from "../lib/trades.ts";
import { useModel } from "../ui/BillGate.tsx";

/** "Lisa C. McClain": the name without the title and without the party and state. */
export const memberName = (n: NodeOf<"member">) => n.label.replace(/^(Sen|Rep)\.\s+/, "").replace(/\s*\(.*\)$/, "");

export const lastName = (n: NodeOf<"member">) => memberShort(n).split(" ")[0]!;

export const roleOf = (n: NodeOf<"member">) => (n.props.chamber === "House" ? "representative" : "senator");

/**
 * What the record says about a member whose last term before the bill ended before its Congress began, so the page
 * never reads as if they sat for the bill. Null for everyone else, in the same words for every party.
 */
export function formerNote(n: NodeOf<"member">, congress: number): string | null {
  const term = n.props.term;
  if (!term || term.end > `${1789 + 2 * (congress - 1)}-01-03`) return null;
  return `Former ${roleOf(n)} · served ${day(term.start)} to ${day(term.end)}, before the ${ordinal(congress)} Congress`;
}

/** "Rep. McClain R-MI": how every member is named in a list. */
export const chipName = (n: NodeOf<"member">) =>
  `${n.label.slice(0, 4)} ${lastName(n)} ${n.props.party}-${n.props.state}`;

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
            title={[
              count(r.companies, "company", "companies"),
              count(r.trades, "trade"),
              formerNote(r.member.node, m.b.bill.congress),
            ]
              .filter(Boolean)
              .join(", ")}
          >
            {chipName(r.member.node)} <span>{r.companies}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
