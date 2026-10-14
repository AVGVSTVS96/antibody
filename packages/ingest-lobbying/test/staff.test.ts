import { expect, test } from "bun:test";
import { namedMembers } from "../src/staff.ts";

test("members named in covered positions, as written", () => {
  expect(namedMembers("Chief of Staff, Rep. David Kustoff")).toEqual(["Rep. David Kustoff"]);
  expect(namedMembers("Financial Services Fellow, Rep. French Hill")).toEqual(["Rep. French Hill"]);
  expect(namedMembers("Staff Assistant, Deputy Chief of Staff, Chief of Staff, Sen.Lott, 1996-97")).toEqual([
    "Sen. Lott",
  ]);
  expect(namedMembers("CHIEF OF STAFF & SENIOR ADVISOR, REP. BARBARA LEE (6/22 - 5/24 )")).toEqual([
    "Rep. Barbara Lee",
  ]);
  expect(
    namedMembers("Legislative Director, Senator Schumer (2010-2013); Legislative Director, Congressman Israel"),
  ).toEqual(["Sen. Schumer", "Rep. Israel"]);
  expect(namedMembers("Legislative Aide, Office of Senate Majority Leader Charles Schumer")).toEqual([
    "Leader Charles Schumer",
  ]);
  expect(namedMembers("Rep. David Scott (GA) Senior Leg Assistant 2016-2018")).toEqual(["Rep. David Scott"]);
});

test("committees and offices are not members", () => {
  expect(namedMembers("Staff Asst., Sen. Commerce, Science & Transportation Cmte.")).toEqual([]);
  expect(namedMembers("Senior PSM and PSM, Sen. Small Business Committee")).toEqual([]);
  expect(namedMembers("House Majority Leader Deputy Floor Director")).toEqual([]);
  expect(namedMembers("Senior Professional Staff, House Financial Services Committee")).toEqual([]);
});
