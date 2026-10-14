import type { NodeOf } from "@antibody/core";
import { count, day } from "../lib/format.ts";
import { formerNote, lastName } from "../money/Members.tsx";
import { useModel } from "../ui/BillGate.tsx";
import { Src } from "../ui/receipt.tsx";
import { type CastVote, votesOf } from "./votes.ts";

const WORD = { Yea: "YEA", Nay: "NAY", Present: "PRESENT", "Not Voting": "NOT VOTING" } as const;

const question = (v: CastVote) => v.roll.question.replace(/\s*\(.*$/, "").replace(/^On (the )?/i, "");

function Roll({ cast }: { cast: CastVote }) {
  const { roll } = cast;
  return (
    <Src
      ids={cast.claims}
      label={`${roll.chamber === "House" ? "Clerk roll" : "Senate vote"} ${roll.number}`}
      context={`${roll.chamber} vote ${roll.number}`}
    />
  );
}

/** How the member voted on the bill: the votes that decide it, and every roll call behind them. */
export function Votes({ member }: { member: NodeOf<"member"> }) {
  const m = useModel();
  const all = votesOf(m, member.id);
  const decisive = all.filter((v) => v.decisive);
  return (
    <div className="votes">
      <div className="votes-card">
        <p className="votes-head">
          How {lastName(member)} voted on {m.b.bill.display} · fact
        </p>
        {decisive.length > 0 ? (
          <ul className="votes-list">
            {decisive.map((v) => (
              <li key={v.roll.id}>
                <p>
                  {day(v.roll.date)} · {question(v)} · {v.roll.yeas}-{v.roll.nays}
                </p>
                <strong data-vote={v.vote}>{WORD[v.vote]}</strong>
                <Roll cast={v} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="votes-none">
            {all.length
              ? "No passage vote of this bill is recorded for this member."
              : formerNote(member, m)
                ? "Not in office when this bill was voted."
                : "No roll-call vote on this bill is recorded for this member. A member not yet in office, or a chamber that passed the bill by consent, has none."}
          </p>
        )}
      </div>
      {all.length > decisive.length && (
        <details className="votes-all">
          <summary>All {count(all.length, "roll call")} on this bill</summary>
          <ul>
            {all.map((v) => (
              <li key={v.roll.id}>
                <span>{day(v.roll.date)}</span>
                <span>{question(v)}</span>
                <b>{WORD[v.vote]}</b>
                <Roll cast={v} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
