import { billRef, type Stage } from "@antibody/core";
import { readRows, writeRows } from "@antibody/core/node";
import { committeeMemberRows, committeeRows } from "./committees.ts";
import { fetchMembers, memberLookup } from "./legislators.ts";
import { upsertRows } from "./upsert.ts";
import { billRolls } from "./votes.ts";

export { billstatus, recordedVotes, type Sponsor } from "./billstatus.ts";
export { committeeId, congressSpan } from "./committees.ts";
export { type Lookup, memberLookup, partyLetter, termOn } from "./legislators.ts";
export { upsertRows } from "./upsert.ts";
export { rollId } from "./votes.ts";

export const stages: Stage[] = [
  {
    name: "members",
    scope: "global",
    needs: [],
    writes: ["members", "committees"],
    async run({ refresh, log }) {
      const members = await fetchMembers(refresh);
      await writeRows("members", "legislators", members);
      const committees = await committeeRows(refresh);
      await writeRows("committees", "legislators", committees);
      log(`${members.length} members since 1993, ${committees.length} committees and subcommittees`);
    },
  },
  {
    name: "committee-members",
    scope: "bill",
    needs: ["members"],
    writes: ["committee_members"],
    async run({ bill, refresh, log }) {
      const { congress } = billRef(bill!);
      if (!refresh && (await readRows("committee_members", String(congress))).length)
        return log(`${congress}th Congress roster cached`);
      const rows = await committeeMemberRows(congress);
      await writeRows("committee_members", String(congress), rows);
      log(`${rows.length} seats in the ${congress}th Congress`);
    },
  },
  {
    name: "votes",
    scope: "bill",
    needs: ["members"],
    writes: ["roll_calls", "member_votes"],
    async run({ bill, refresh, log }) {
      const rolls = await billRolls(bill!, await memberLookup(), refresh);
      const shards = Map.groupBy(rolls, (r) => `${r.roll.chamber.toLowerCase()}-${r.roll.congress}-${r.roll.session}`);
      for (const [shard, group] of shards) {
        await upsertRows(
          "roll_calls",
          shard,
          group.map((g) => g.roll),
        );
        await upsertRows(
          "member_votes",
          shard,
          group.flatMap((g) => g.votes),
        );
      }
      const unmatched = rolls.flatMap((r) => r.unmatched.map((u) => `${r.roll.id} ${u}`));
      log(`${rolls.length} roll calls, ${rolls.reduce((n, r) => n + r.votes.length, 0)} member votes`);
      if (unmatched.length) log(`unmatched voters: ${unmatched.join(", ")}`);
    },
  },
];
