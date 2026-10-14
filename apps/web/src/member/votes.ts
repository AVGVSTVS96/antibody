import type { Bundle, NodeId } from "@antibody/core";
import type { BillModel } from "../lib/model.ts";

export type RollCall = Bundle["votes"][number];

export interface CastVote {
  roll: RollCall;
  vote: "Yea" | "Nay" | "Present" | "Not Voting";
  claims: string[];
  /** Passage, or agreeing to the other chamber's version: the votes that decide whether the bill goes on. */
  decisive: boolean;
}

const DECIDES = /passage|\bpass\b|concur/i;
const STEPS = /proceed|cloture|recommit|table|reconsider/i;

/** A roll call that sends the bill on (passage, or concurring in the other chamber's text). */
export const decides = (r: Pick<RollCall, "question">) => DECIDES.test(r.question) && !STEPS.test(r.question);

/** Every roll call of the bill a member cast a vote on, oldest first. */
export function votesOf(m: BillModel, member: NodeId): CastVote[] {
  const rolls = new Map(m.b.votes.map((r) => [r.id, r]));
  const out: CastVote[] = [];
  for (const e of m.b.edges) {
    if (e.kind !== "voted" || e.src !== member) continue;
    const roll = rolls.get(e.props.rollId);
    if (roll) out.push({ roll, vote: e.props.vote, claims: e.claims, decisive: decides(roll) });
  }
  return out.sort((a, b) => a.roll.date.localeCompare(b.roll.date) || a.roll.number - b.roll.number);
}

/** Passage and concurrence votes of both chambers, then the signing: the lines drawn across the bill's trades. */
export function milestones(m: BillModel): { date: string; label: string }[] {
  const out = m.b.votes
    .filter(decides)
    .map((r) => ({ date: r.date, label: `${r.chamber} ${/concur/i.test(r.question) ? "concurs" : "passes"}` }));
  if (m.b.bill.lawOn) out.push({ date: m.b.bill.lawOn, label: "signed" });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
