import { join } from "node:path";
import type { BillId, Row } from "@antibody/core";
import { paths } from "@antibody/core/node";
import { billstatus, type RecordedVote, recordedVotes, xml } from "./billstatus.ts";
import { cached } from "./fetch.ts";
import type { Lookup } from "./legislators.ts";

type Vote = Row<"member_votes">["vote"];
const VOTE: Record<string, Vote> = {
  Yea: "Yea",
  Aye: "Yea",
  Nay: "Nay",
  No: "Nay",
  Present: "Present",
  "Not Voting": "Not Voting",
};

/** Roll call id, the same one amendments.roll_id and bundle.votes use: `senate-119-1-318`, `house-119-1-200`. */
export const rollId = (chamber: "House" | "Senate", congress: number, session: number, number: number) =>
  `${chamber.toLowerCase()}-${congress}-${session}-${number}`;

/** "17-Jul-2025" (House) or "June 17, 2025,  05:11 PM" (Senate) → 2025-06-17, read as written (no time zone shift). */
export function voteDate(text: string): string {
  const d = new Date(`${text.replace(/,\s+\d{1,2}:\d{2}\s*[AP]M$/i, "").replaceAll("-", " ")} 12:00 UTC`);
  if (Number.isNaN(d.getTime())) throw new Error(`unreadable vote date: ${text}`);
  return d.toISOString().slice(0, 10);
}

export interface ParsedRoll {
  roll: Row<"roll_calls">;
  votes: Row<"member_votes">[];
  unmatched: string[];
}

const str = (v: unknown) =>
  v == null ? "" : typeof v === "object" ? String((v as { "#text"?: unknown })["#text"] ?? "") : String(v);
const int = (v: unknown) => Number.parseInt(str(v) || "0", 10);

export function parseHouseRoll(text: string, url: string, bill: BillId | null, lookup: Lookup): ParsedRoll {
  const r = xml.parse(text)["rollcall-vote"];
  const m = r["vote-metadata"];
  const congress = int(m.congress);
  const session = int(m.session);
  const number = int(m["rollcall-num"]);
  const id = rollId("House", congress, session, number);
  const totals = m["vote-totals"]["totals-by-vote"];
  const amendment = str(m["amendment-num"]) && `amendment ${str(m["amendment-num"])} by ${str(m["amendment-author"])}`;
  const what = [str(m["legis-num"]), amendment].filter(Boolean).join(", ");
  const roll: Row<"roll_calls"> = {
    id,
    bill_id: bill,
    chamber: "House",
    congress,
    session,
    number,
    date: voteDate(str(m["action-date"])),
    question: what ? `${str(m["vote-question"])} (${what})` : str(m["vote-question"]),
    result: str(m["vote-result"]),
    yeas: int(totals["yea-total"]),
    nays: int(totals["nay-total"]),
    url,
    source_url: url,
    source_locator: "vote-metadata",
  };
  const votes: Row<"member_votes">[] = [];
  const unmatched: string[] = [];
  for (const rv of [r["vote-data"]["recorded-vote"]].flat()) {
    const bioguide = rv.legislator["@name-id"] as string;
    const vote = VOTE[str(rv.vote)];
    if (!vote || !lookup.byBioguide.has(bioguide)) {
      unmatched.push(`${bioguide}:${str(rv.vote)}`);
      continue;
    }
    votes.push({
      id: `${id}:${bioguide}`,
      roll_id: id,
      bioguide,
      vote,
      source_url: url,
      source_locator: `recorded-vote, legislator name-id="${bioguide}"`,
    });
  }
  return { roll, votes, unmatched };
}

export function parseSenateRoll(text: string, url: string, bill: BillId | null, lookup: Lookup): ParsedRoll {
  const r = xml.parse(text).roll_call_vote;
  const congress = int(r.congress);
  const session = int(r.session);
  const number = int(r.vote_number);
  const id = rollId("Senate", congress, session, number);
  const tie = r.tie_breaker ?? {};
  const tieBroken = str(tie.by_whom) && `tie broken by the ${str(tie.by_whom)}, voting ${str(tie.tie_breaker_vote)}`;
  const roll: Row<"roll_calls"> = {
    id,
    bill_id: bill,
    chamber: "Senate",
    congress,
    session,
    number,
    date: voteDate(str(r.vote_date)),
    question: str(r.vote_question_text),
    result: tieBroken ? `${str(r.vote_result)} (${tieBroken})` : str(r.vote_result),
    yeas: int(r.count.yeas),
    nays: int(r.count.nays),
    url,
    source_url: url,
    source_locator: "roll_call_vote",
  };
  const votes: Row<"member_votes">[] = [];
  const unmatched: string[] = [];
  for (const m of [r.members.member].flat()) {
    const lis = str(m.lis_member_id);
    const bioguide = lookup.byLis.get(lis);
    const vote = VOTE[str(m.vote_cast)];
    if (!vote || !bioguide) {
      unmatched.push(`${lis}:${str(m.vote_cast)}`);
      continue;
    }
    votes.push({
      id: `${id}:${bioguide}`,
      roll_id: id,
      bioguide,
      vote,
      source_url: url,
      source_locator: `member lis_member_id ${lis} (${str(m.member_full)})`,
    });
  }
  return { roll, votes, unmatched };
}

async function readRoll(v: RecordedVote, bill: BillId, lookup: Lookup): Promise<ParsedRoll> {
  const id = rollId(v.chamber, +v.congress, +v.sessionNumber, +v.rollNumber);
  const text = await cached(v.url, join(paths.raw("members"), "votes", `${id}.xml`));
  return v.chamber === "House" ? parseHouseRoll(text, v.url, bill, lookup) : parseSenateRoll(text, v.url, bill, lookup);
}

/** Roll calls on the bill and its amendments, as BILLSTATUS lists them, read from the House Clerk and senate.gov XML. */
export async function billRolls(bill: BillId, lookup: Lookup, refresh: boolean): Promise<ParsedRoll[] | null> {
  const status = await billstatus(bill, refresh);
  if (!status) return null;
  const listed = recordedVotes(status);
  const out: ParsedRoll[] = [];
  for (const v of listed) out.push(await readRoll(v, bill, lookup));
  return out.sort((a, b) => a.roll.date.localeCompare(b.roll.date) || a.roll.number - b.roll.number);
}
