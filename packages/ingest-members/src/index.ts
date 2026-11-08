import { billRef } from "@antibody/core";
import type { BillId, Stage, StageContext } from "@antibody/core";
import { readRows, writeRows } from "@antibody/core/node";
import { committeeMemberRows, committeeRows } from "./committees.ts";
import { fetchMembers, memberLookup } from "./legislators.ts";
import { upsertRows } from "./upsert.ts";
import { billRolls } from "./votes.ts";

export { billstatus, recordedVotes } from "./billstatus.ts";

export { committeeId, congressSpan } from "./committees.ts";

export { type Lookup, memberLookup, partyLetter, termOn } from "./legislators.ts";

export { upsertRows } from "./upsert.ts";

export { rollId } from "./votes.ts";

function billOf(ctx: StageContext): BillId {
  if (ctx.bill === null) {
    throw new Error("this stage runs per bill");
  }

  return ctx.bill;
}

export const stages: Stage[] = [
  {
    name: "members",
    scope: "global",
    needs: [],
    writes: ["members", "committees"],
    async run(ctx) {
      const members = await fetchMembers(ctx.refresh);
      await writeRows("members", "legislators", members);
      const committees = await committeeRows(ctx.refresh);
      await upsertRows("committees", "legislators", committees);
      ctx.log(`${members.length} members since 1993, ${committees.length} committees and subcommittees`);
    },
  },
  {
    name: "committee-members",
    scope: "bill",
    needs: ["members"],
    writes: ["committee_members", "committees"],
    async run(ctx) {
      const { congress } = billRef(billOf(ctx));

      if (!ctx.refresh && (await readRows("committee_members", String(congress))).length > 0) {
        ctx.log(`${congress}th Congress roster cached`);

        return;
      }

      const { seats, committees } = await committeeMemberRows(congress);
      await writeRows("committee_members", String(congress), seats);

      if (committees.length > 0) {
        await upsertRows("committees", "legislators", committees);
      }

      ctx.log(`${seats.length} seats in the ${congress}th Congress; ${committees.length} retired subcommittees added`);
    },
  },
  {
    name: "votes",
    scope: "bill",
    needs: ["members"],
    writes: ["roll_calls", "member_votes"],
    async run(ctx) {
      const rolls = await billRolls(billOf(ctx), await memberLookup(), ctx.refresh);

      if (rolls === null) {
        ctx.log("GovInfo has no BILLSTATUS for this bill yet");

        return;
      }

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
      ctx.log(`${rolls.length} roll calls, ${rolls.reduce((n, r) => n + r.votes.length, 0)} member votes`);

      if (unmatched.length > 0) {
        ctx.log(`unmatched voters: ${unmatched.join(", ")}`);
      }
    },
  },
];
