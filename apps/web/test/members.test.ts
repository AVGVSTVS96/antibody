import { expect, test } from "bun:test";
import { formerNote, seatOf } from "../src/money/Members.tsx";

const member = (
  chamber: "House" | "Senate",
  term: { start: string; end: string } | null,
  state = "FL",
  district: number | null = 3,
) => ({ props: { chamber, term, state, district } }) as never;
const bill = (votes: { chamber: string; date: string; question: string }[]) =>
  ({ b: { votes, bill: { display: "H.R.1", congress: 119, lawOn: "2025-07-04" } } }) as never;
const votes = [
  { chamber: "House", date: "2025-05-22", question: "On Passage" },
  { chamber: "Senate", date: "2025-07-01", question: "On Passage" },
  { chamber: "Senate", date: "2025-06-30", question: "On the Motion to Proceed" },
];

test("a member whose term ended before their chamber's votes is former, in the same words for everyone", () => {
  expect(formerNote(member("Senate", { start: "2023-01-03", end: "2025-01-20" }), bill(votes))).toBe(
    "Former senator · term ran Jan 3, 2023 to Jan 20, 2025, before H.R.1 was voted",
  );
  expect(formerNote(member("House", { start: "2023-01-03", end: "2025-05-21" }), bill(votes))).toContain(
    "Former representative",
  );
});

test("a member in office on the day of the vote, or with no term on record, is not marked", () => {
  expect(formerNote(member("House", { start: "2023-01-03", end: "2025-05-22" }), bill(votes))).toBeNull();
  expect(formerNote(member("Senate", { start: "2025-01-03", end: "2031-01-03" }), bill(votes))).toBeNull();
  expect(formerNote(member("Senate", null), bill(votes))).toBeNull();
});

test("a chamber with no passage vote falls back to the other's, then to the law date", () => {
  expect(formerNote(member("Senate", { start: "2023-01-03", end: "2025-05-01" }), bill([votes[0]!]))).not.toBeNull();
  expect(formerNote(member("House", { start: "2023-01-03", end: "2025-07-05" }), bill([]))).toBeNull();
  expect(formerNote(member("House", { start: "2023-01-03", end: "2025-07-03" }), bill([]))).not.toBeNull();
});

test("at-large seats read AL, not 0", () => {
  expect(seatOf(member("House", null, "MT", 0))).toBe("MT-AL");
  expect(seatOf(member("House", null, "CA", 39))).toBe("CA-39");
  expect(seatOf(member("Senate", null, "OH", null))).toBe("OH");
});
