import { expect, test } from "bun:test";
import { TABLES } from "@antibody/core";
import { type BillStatus, recordedVotes } from "../src/billstatus.ts";
import { committeeId, congressSpan } from "../src/committees.ts";
import { type Lookup, memberRow, termOn } from "../src/legislators.ts";
import { parseHouseRoll, parseSenateRoll, voteDate } from "../src/votes.ts";

const sinema = memberRow(
  {
    id: { bioguide: "S001191", lis: "S403", fec: ["S8AZ00197"] },
    name: { first: "Kyrsten", last: "Sinema", official_full: "Kyrsten Sinema" },
    terms: [
      { type: "rep", start: "2017-01-03", end: "2019-01-03", state: "AZ", district: 9, party: "Democrat" },
      {
        type: "sen",
        start: "2019-01-03",
        end: "2025-01-03",
        state: "AZ",
        party: "Independent",
        party_affiliations: [
          { start: "2019-01-03", end: "2022-12-08", party: "Democrat" },
          { start: "2022-12-09", end: "2025-01-03", party: "Independent", caucus: "Democrat" },
        ],
      },
    ],
  },
  "legislators-historical",
);

const lookup: Lookup = {
  byBioguide: new Map([
    ["S001191", sinema],
    ["C001123", { ...sinema, id: "C001123" }],
  ]),
  byLis: new Map([["S403", "S001191"]]),
  byFec: new Map(),
};

test("a mid-term party switch splits the term, and the bill's date picks the party", () => {
  expect(TABLES.members.schema.safeParse(sinema).success).toBe(true);
  expect(sinema.party).toBe("I");
  expect(sinema.terms.map((t) => t.party)).toEqual(["Democrat", "Democrat", "Independent"]);
  expect(termOn(sinema, "2022-08-07").party).toBe("Democrat");
  expect(termOn(sinema, "2023-05-01")).toMatchObject({ party: "Independent", caucus: "Democrat" });
  expect(termOn(sinema, "2018-01-01")).toMatchObject({ chamber: "House", district: 9 });
});

test("ids and dates", () => {
  expect(committeeId("ssbk00")).toBe("SSBK");
  expect(committeeId("hsag15")).toBe("HSAG15");
  expect(congressSpan(119)).toEqual({ start: "2025-01-03", end: "2027-01-03" });
  expect(voteDate("17-Jul-2025")).toBe("2025-07-17");
  expect(voteDate("June 17, 2025,  05:11 PM")).toBe("2025-06-17");
  expect(voteDate("August 7, 2022, 03:04 PM")).toBe("2022-08-07");
});

test("House roll: Aye counts as Yea, unknown legislators are reported, not dropped silently", () => {
  const { roll, votes, unmatched } = parseHouseRoll(
    `<rollcall-vote><vote-metadata><congress>119</congress><session>1st</session><rollcall-num>200</rollcall-num>
     <legis-num>S 1582</legis-num><vote-question>On Passage</vote-question><vote-result>Passed</vote-result>
     <action-date>17-Jul-2025</action-date><vote-totals><totals-by-vote><yea-total>308</yea-total><nay-total>122</nay-total>
     </totals-by-vote></vote-totals></vote-metadata><vote-data>
     <recorded-vote><legislator name-id="C001123">Cisneros</legislator><vote>No</vote></recorded-vote>
     <recorded-vote><legislator name-id="X000000">Nobody</legislator><vote>Aye</vote></recorded-vote>
     </vote-data></rollcall-vote>`,
    "https://clerk.house.gov/evs/2025/roll200.xml",
    "119-s-1582",
    lookup,
  );
  expect(roll).toMatchObject({ id: "house-119-1-200", question: "On Passage (S 1582)", yeas: 308, nays: 122 });
  expect(votes).toEqual([expect.objectContaining({ id: "house-119-1-200:C001123", vote: "Nay" })]);
  expect(unmatched).toEqual(["X000000:Aye"]);
  expect(TABLES.roll_calls.schema.safeParse(roll).success).toBe(true);
});

test("Senate roll: LIS ids map to bioguide; a Vice President's tie-break is written into the result", () => {
  const { roll, votes } = parseSenateRoll(
    `<roll_call_vote><congress>117</congress><session>2</session><vote_number>325</vote_number>
     <vote_date>August 7, 2022,  03:04 PM</vote_date><vote_question_text>On Passage of the Bill H.R. 5376</vote_question_text>
     <vote_result>Bill Passed</vote_result><count><yeas>50</yeas><nays>50</nays></count>
     <tie_breaker><by_whom>Vice President of the United States</by_whom><tie_breaker_vote>Yea</tie_breaker_vote></tie_breaker>
     <members><member><member_full>Sinema (D-AZ)</member_full><vote_cast>Yea</vote_cast><lis_member_id>S403</lis_member_id></member></members>
     </roll_call_vote>`,
    "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1172/vote_117_2_00325.xml",
    "117-hr-5376",
    lookup,
  );
  expect(roll.id).toBe("senate-117-2-325");
  expect(roll.result).toBe("Bill Passed (tie broken by the Vice President of the United States, voting Yea)");
  expect(votes[0]).toMatchObject({ bioguide: "S001191", vote: "Yea" });
});

test("recorded votes are found anywhere in BILLSTATUS, once each", () => {
  const rv = (n: number) => ({
    rollNumber: String(n),
    url: `https://clerk.house.gov/evs/2025/roll${n}.xml`,
    chamber: "House",
    congress: "119",
    sessionNumber: "1",
    date: "2025-05-22T00:00:00Z",
  });
  const found = recordedVotes({
    actions: { item: [{ recordedVotes: { recordedVote: [rv(145)] } }, { recordedVotes: { recordedVote: [rv(145)] } }] },
    amendments: { amendment: [{ actions: { actions: { item: [{ recordedVotes: { recordedVote: [rv(144)] } }] } } }] },
  } as BillStatus);
  expect(found.map((v) => v.rollNumber).sort()).toEqual(["144", "145"]);
});
