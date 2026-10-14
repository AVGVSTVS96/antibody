import type { NodeOf } from "@antibody/core";
import { useMemo } from "react";
import { count, day, usd } from "../lib/format.ts";
import { pacName } from "../lib/pac.ts";
import { tiedDonors } from "../lib/trades.ts";
import { lastName } from "../money/Members.tsx";
import { useModel } from "../ui/BillGate.tsx";
import { Src } from "../ui/receipt.tsx";

/** The member's tied PAC donors that netted money (up to 5, the largest kept), before and after the member's own passage vote. A floor. */
export function Donors({ member }: { member: NodeOf<"member"> }) {
  const m = useModel();
  const pacs = useMemo(() => new Map(m.b.nodes.flatMap((n) => (n.kind === "pac" ? [[n.id, n] as const] : []))), [m]);
  const { given, returned } = useMemo(() => {
    const d = tiedDonors(m.memberById.get(member.id)!);
    return { given: d.given.sort((a, b) => b.edge.props.amountUsd - a.edge.props.amountUsd), returned: d.returned };
  }, [m, member.id]);
  const edges = given.map((g) => g.edge);
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
  const span =
    cutoff &&
    (firstGift! > cutoff.cutoff
      ? `No gift came before the cutoff; "after" covers the cutoff to ${day(lastGift)}.`
      : lastGift! < cutoff.cutoff
        ? `"Before" covers ${day(firstGift)} to the cutoff; no gift came after it.`
        : `"Before" covers ${day(firstGift)} to the cutoff and "after" the cutoff to ${day(lastGift)}, spans of different length: these are not rates.`);
  return (
    <div className="donors">
      {edges.length > 0 && (
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
                  <th scope="row">{pacName(pacs.get(e.src)?.label ?? e.src)}</th>
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
        {span && ` ${span}`}
      </p>
      {returned.length > 0 && (
        <p className="kicker">
          {count(returned.length, "tied PAC")} netted $0 or less (
          {returned.length === 1 ? "a gift the campaign gave back" : "gifts the campaign gave back"}) and{" "}
          {returned.length === 1 ? "is" : "are"} left out:{" "}
          {returned.map((f, i) => (
            <span key={f.edge.id}>
              {i > 0 && ", "}
              {pacName(pacs.get(f.edge.src)?.label ?? f.edge.src)}{" "}
              <Src
                ids={f.edge.claims}
                label={`${f.edge.props.contributions} ${f.edge.props.contributions === 1 ? "gift" : "gifts"}`}
              />
            </span>
          ))}
          .
        </p>
      )}
    </div>
  );
}
