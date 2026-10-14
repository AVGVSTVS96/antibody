import type { NodeOf } from "@antibody/core";
import { useModel } from "../ui/BillGate.tsx";
import { Src } from "../ui/receipt.tsx";

/** The member's full-committee seats, each with its roster record. */
export function Seats({ member }: { member: NodeOf<"member"> }) {
  const m = useModel();
  const seats = [...(m.memberById.get(member.id)?.committees ?? [])].sort(
    (a, b) =>
      Number(!!b.edge.props.role) - Number(!!a.edge.props.role) || a.committee.label.localeCompare(b.committee.label),
  );
  const unlisted = m.b.gaps.find((g) => g.id === "seats-unlisted" && g.nodes.includes(member.id));
  return (
    <div className="seats">
      {seats.length > 0 ? (
        <ul>
          {seats.map(({ committee, edge }) => (
            <li key={edge.id}>
              <b>{committee.label}</b>
              <span>{edge.props.role ?? "Member"}</span>
              <Src ids={edge.claims} label="Roster" />
            </li>
          ))}
        </ul>
      ) : (
        <p>{unlisted ? unlisted.text : "No committee seat for this member is in the roster snapshot."}</p>
      )}
      <p className="kicker">
        A seat is a seat in this Congress, not a role on this bill. Seats come from one roster snapshot, dated in each
        source note; a member who joined or left mid-term may be missing.
      </p>
    </div>
  );
}
