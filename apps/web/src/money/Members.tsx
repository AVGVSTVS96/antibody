import type { NodeOf } from "@antibody/core";
import { count, day } from "../lib/format.ts";
import { type BillModel, memberShort } from "../lib/model.ts";
import { memberHref, onLink } from "../lib/router.ts";
import type { Ranked } from "../lib/trades.ts";
import { decides } from "../member/votes.ts";
import { useModel } from "../ui/BillGate.tsx";

/** "Lisa C. McClain": the name without the title and without the party and state. */
export const memberName = (n: NodeOf<"member">) => n.label.replace(/^(Sen|Rep)\.\s+/, "").replace(/\s*\(.*\)$/, "");

export const lastName = (n: NodeOf<"member">) => memberShort(n).split(" ")[0]!;

export const roleOf = (n: NodeOf<"member">) => (n.props.chamber === "House" ? "representative" : "senator");

/** "MT-AL": a state with one seat, and the territories' delegates, are at large. */
export const seatOf = (n: NodeOf<"member">) =>
  n.props.district == null ? n.props.state : `${n.props.state}-${n.props.district === 0 ? "AL" : n.props.district}`;

/** The day the member's chamber first passed the bill (or agreed to the other's text), else the law date or the Congress's start. */
function votedOn(m: BillModel, n: NodeOf<"member">): string {
  const days = m.b.votes.filter(decides).map((r) => ({ chamber: r.chamber, date: r.date }));
  const own = days.filter((d) => d.chamber === n.props.chamber);
  const first = (xs: typeof days) => xs.map((d) => d.date).sort()[0];
  return first(own) ?? first(days) ?? m.b.bill.lawOn ?? `${1789 + 2 * (m.b.bill.congress - 1)}-01-03`;
}

/**
 * What the record says about a member whose term ended before the bill's votes in their chamber (before its Congress
 * began, or during it), so the page never reads as if they sat for the bill. Null for everyone else, in the same
 * words for every party.
 */
export function formerNote(n: NodeOf<"member">, m: BillModel): string | null {
  const term = n.props.term;
  if (!term || term.end >= votedOn(m, n)) return null;
  return `Former ${roleOf(n)} · term ran ${day(term.start)} to ${day(term.end)}, before ${m.b.bill.display} was voted`;
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
            title={[count(r.companies, "company", "companies"), count(r.trades, "trade"), formerNote(r.member.node, m)]
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
