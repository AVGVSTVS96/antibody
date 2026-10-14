import { useState } from "react";
import { memberHref, onLink } from "../lib/router.ts";
import type { Ranked } from "../lib/trades.ts";
import { chipName } from "../money/Members.tsx";
import { useModel } from "../ui/BillGate.tsx";

const SHOWN = 7;

/** Every member who traded a tied company, in the one rule's order, the member's own row marked. */
export function Touch({ ranked, current, unit }: { ranked: Ranked[]; current: string; unit: string }) {
  const m = useModel();
  const [all, setAll] = useState(false);
  const at = ranked.findIndex((r) => r.member.node.id === current);
  const top = ranked[0]?.companies ?? 1;
  const list = all ? ranked : ranked.slice(0, SHOWN);
  const extra = !all && at >= SHOWN ? ranked[at] : null;
  const row = (r: Ranked, rank?: number) => (
    <li key={r.member.node.id} data-here={r.member.node.id === current || undefined}>
      <a href={memberHref(m.b.bill.id, r.member.node.props.bioguide)} onClick={onLink}>
        {chipName(r.member.node)}
        {r.member.node.id === current && <em> ◂ here</em>}
        {rank != null && <small> #{rank}</small>}
      </a>
      <i style={{ width: `${(r.companies / top) * 100}%` }} aria-hidden="true" />
      <span>{r.companies}</span>
    </li>
  );
  return (
    <div className="touch">
      <p className="touch-head kicker">Member · {unit}</p>
      <ol>
        {list.map((r) => row(r))}
        {extra && (
          <>
            <li className="touch-gap" aria-hidden="true">
              ⋮
            </li>
            {row(extra, at + 1)}
          </>
        )}
      </ol>
      {ranked.length > SHOWN && (
        <button type="button" className="linkbtn" onClick={() => setAll((x) => !x)}>
          {all ? "show fewer" : `show all ${ranked.length}`}
        </button>
      )}
    </div>
  );
}
