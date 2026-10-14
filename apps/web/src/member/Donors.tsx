import type { NodeOf } from "@antibody/core";
import { useMemo } from "react";
import { day, nice, usd } from "../lib/format.ts";
import { lastName } from "../money/Members.tsx";
import { useModel } from "../ui/BillGate.tsx";
import { Src } from "../ui/receipt.tsx";

/** The member's 5 largest tied PAC donors, before and after the member's own passage vote. A floor. */
export function Donors({ member }: { member: NodeOf<"member"> }) {
  const m = useModel();
  const pacs = useMemo(() => new Map(m.b.nodes.flatMap((n) => (n.kind === "pac" ? [[n.id, n] as const] : []))), [m]);
  const gifts = useMemo(
    () =>
      [...(m.memberById.get(member.id)?.funded ?? [])].sort((a, b) => b.edge.props.amountUsd - a.edge.props.amountUsd),
    [m, member.id],
  );
  const edges = gifts.map((g) => g.edge);
  const before = edges.reduce((n, e) => n + e.props.beforeUsd, 0);
  const after = edges.reduce((n, e) => n + e.props.afterUsd, 0);
  const total = before + after;
  const cutoff = edges[0]?.props;
  const when = cutoff && day(cutoff.cutoff);
  const mark =
    cutoff?.cutoffKind === "enactment" ? `${when}, the signing` : `${when}, ${lastName(member)}'s passage vote`;
  const lastGift = edges
    .map((e) => e.props.last)
    .sort()
    .at(-1);
  const firstGift = edges.map((e) => e.props.first).sort()[0];
  const before_ = Math.max(0, Math.min(1, before / Math.max(1, total)));
  return (
    <div className="donors">
      {edges.length === 0 ? (
        <p className="lead">No gift from a tied PAC is in the data for this member.</p>
      ) : (
        <>
          <p className="donors-sum">
            <strong>{usd(total)}</strong>
            <span>
              from {edges.length === 1 ? "one company PAC" : `${edges.length} company PACs`}. {usd(before)} came before{" "}
              {mark}, {usd(after)} after.
            </span>
          </p>
          {total > 0 && (
            <div className="donors-bar" aria-hidden="true">
              <i style={{ width: `${before_ * 100}%` }} />
            </div>
          )}
          <table>
            <thead>
              <tr>
                <th scope="col">PAC</th>
                <th scope="col">Before {day(cutoff!.cutoff).replace(/, \d{4}$/, "")}</th>
                <th scope="col">After</th>
                <th scope="col">FEC</th>
              </tr>
            </thead>
            <tbody>
              {edges.map((e) => (
                <tr key={e.id}>
                  <th scope="row">{nice(pacs.get(e.src)?.label ?? e.src)}</th>
                  <td>{usd(e.props.beforeUsd)}</td>
                  <td>{usd(e.props.afterUsd)}</td>
                  <td>
                    <Src
                      ids={e.claims}
                      label={`${e.props.contributions} ${e.props.contributions === 1 ? "gift" : "gifts"}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="kicker">
        Only each member's 5 largest tied donors are kept, so this is a floor: smaller gifts are in the FEC files.
        {edges.length > 0 &&
          ` "Before" covers ${day(firstGift)} to the cutoff and "after" the cutoff to ${day(lastGift)}, spans of different length: these are not rates.`}
      </p>
    </div>
  );
}
