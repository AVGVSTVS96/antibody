import { join } from "node:path";
import type { BillId, Row } from "@antibody/core";
import { paths } from "@antibody/core/node";
import { billstatus, recordedVotes } from "./billstatus.ts";
import type { RecordedVote } from "./billstatus.ts";
import { cached } from "./fetch.ts";
import type { Lookup } from "./legislators.ts";
import { all, element, isElement, parseXml, text } from "./xml.ts";
import type { XmlElement } from "./xml.ts";

type Vote = Row<"member_votes">["vote"];

const VOTE = new Map<string, Vote>([
  ["Yea", "Yea"],
  ["Aye", "Yea"],
  ["Nay", "Nay"],
  ["No", "Nay"],
  ["Present", "Present"],
  ["Not Voting", "Not Voting"],
]);

export const rollId = (chamber: "House" | "Senate", congress: number, session: number, number: number) =>
  `${chamber.toLowerCase()}-${congress}-${session}-${number}`;

export function voteDate(written: string): string {
  const d = new Date(`${written.replace(/,\s+\d{1,2}:\d{2}\s*[AP]M$/iu, "").replaceAll("-", " ")} 12:00 UTC`);

  if (Number.isNaN(d.getTime())) {
    throw new RangeError(`unreadable vote date: ${written}`);
  }

  return d.toISOString().slice(0, 10);
}

export interface ParsedRoll {
  roll: Row<"roll_calls">;
  votes: Row<"member_votes">[];
  unmatched: string[];
}

const int = (node: XmlElement, tag: string) =>
  // oxlint-disable-next-line unicorn/prefer-number-coercion -- reads the leading digits of a session like "1st"
  Number.parseInt(text(node, tag) || "0", 10);

export function parseHouseRoll(body: string, url: string, bill: BillId | null, lookup: Lookup): ParsedRoll {
  const r = element(parseXml(body), "rollcall-vote");
  const m = element(r, "vote-metadata");
  const congress = int(m, "congress");
  const session = int(m, "session");
  const number = int(m, "rollcall-num");
  const id = rollId("House", congress, session, number);
  const totals = element(element(m, "vote-totals"), "totals-by-vote");
  const amendmentNum = text(m, "amendment-num");
  const amendment = amendmentNum && `amendment ${amendmentNum} by ${text(m, "amendment-author")}`;
  const what = [text(m, "legis-num"), amendment].filter(Boolean).join(", ");

  const roll: Row<"roll_calls"> = {
    id,
    bill_id: bill,
    chamber: "House",
    congress,
    session,
    number,
    date: voteDate(text(m, "action-date")),
    question: what ? `${text(m, "vote-question")} (${what})` : text(m, "vote-question"),
    result: text(m, "vote-result"),
    yeas: int(totals, "yea-total"),
    nays: int(totals, "nay-total"),
    url,
    source_url: url,
    source_locator: "vote-metadata",
  };

  const votes: Row<"member_votes">[] = [];
  const unmatched: string[] = [];

  for (const rv of all(element(r, "vote-data"), "recorded-vote")) {
    const bioguide = text(element(rv, "legislator"), "@name-id");
    const cast = text(rv, "vote");
    const vote = VOTE.get(cast);

    if (vote === undefined || !lookup.byBioguide.has(bioguide)) {
      unmatched.push(`${bioguide}:${cast}`);
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

export function parseSenateRoll(body: string, url: string, bill: BillId | null, lookup: Lookup): ParsedRoll {
  const r = element(parseXml(body), "roll_call_vote");
  const congress = int(r, "congress");
  const session = int(r, "session");
  const number = int(r, "vote_number");
  const id = rollId("Senate", congress, session, number);
  const count = element(r, "count");
  const tie = isElement(r.tie_breaker) ? r.tie_breaker : {};
  const byWhom = text(tie, "by_whom");
  const tieBroken = byWhom && `tie broken by the ${byWhom}, voting ${text(tie, "tie_breaker_vote")}`;

  const roll: Row<"roll_calls"> = {
    id,
    bill_id: bill,
    chamber: "Senate",
    congress,
    session,
    number,
    date: voteDate(text(r, "vote_date")),
    question: text(r, "vote_question_text"),
    result: tieBroken ? `${text(r, "vote_result")} (${tieBroken})` : text(r, "vote_result"),
    yeas: int(count, "yeas"),
    nays: int(count, "nays"),
    url,
    source_url: url,
    source_locator: "roll_call_vote",
  };

  const votes: Row<"member_votes">[] = [];
  const unmatched: string[] = [];

  for (const m of all(element(r, "members"), "member")) {
    const lis = text(m, "lis_member_id");
    const bioguide = lookup.byLis.get(lis);
    const cast = text(m, "vote_cast");
    const vote = VOTE.get(cast);

    if (vote === undefined || bioguide === undefined || bioguide === "") {
      unmatched.push(`${lis}:${cast}`);
      continue;
    }

    votes.push({
      id: `${id}:${bioguide}`,
      roll_id: id,
      bioguide,
      vote,
      source_url: url,
      source_locator: `member lis_member_id ${lis} (${text(m, "member_full")})`,
    });
  }

  return { roll, votes, unmatched };
}

async function readRoll(v: RecordedVote, bill: BillId, lookup: Lookup): Promise<ParsedRoll> {
  const id = rollId(v.chamber, +v.congress, +v.sessionNumber, +v.rollNumber);
  const body = await cached(v.url, join(paths.raw("members"), "votes", `${id}.xml`));

  return v.chamber === "House" ? parseHouseRoll(body, v.url, bill, lookup) : parseSenateRoll(body, v.url, bill, lookup);
}

export async function billRolls(bill: BillId, lookup: Lookup, refresh: boolean): Promise<ParsedRoll[] | null> {
  const status = await billstatus(bill, refresh);

  if (status === null) {
    return null;
  }

  const listed = recordedVotes(status);
  const out: ParsedRoll[] = [];

  for (const v of listed) {
    out.push(await readRoll(v, bill, lookup));
  }

  return out.toSorted((a, b) => a.roll.date.localeCompare(b.roll.date) || a.roll.number - b.roll.number);
}
