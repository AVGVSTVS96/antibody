import { expect, test } from "bun:test";
import { sameCompanyName } from "../src/review.ts";
import { ownedOn, ownedSince } from "../src/since.ts";

test("the day a subsidiary came under its parent is read from the reviewer's reason", () => {
  expect(ownedSince("Denbury was acquired by ExxonMobil in November 2023.")).toBe("2023-11-01");
  expect(ownedSince("Synopsys completed its acquisition of ANSYS in 2025.")).toBe("2025-12-31");
  expect(ownedSince("Red Hat has been wholly owned by IBM since 2019.")).toBe("2019-12-31");
});

test("a rename or reorganization of one company is not a change of owner", () => {
  expect(ownedSince("Anthem Inc. was renamed Elevance Health in 2022, and CareMore is its subsidiary.")).toBeNull();
  expect(ownedSince("Apache is a subsidiary of APA since the 2021 holding-company reorganization.")).toBeNull();
  expect(ownedSince("ExxonMobil is the listed ExxonMobil parent.")).toBeNull();
  expect(ownedSince(null)).toBeNull();
});

test("a filing counts only from the day the parent owned the subsidiary", () => {
  expect(ownedOn("2023-11-01", "2022-06-30")).toBe(false);
  expect(ownedOn("2023-11-01", "2023-12-31")).toBe(true);
  expect(ownedOn(null, "2020-01-01")).toBe(true);
});

test("a proposed parent matches SEC's spelling once spaces and suffixes go", () => {
  expect(sameCompanyName("Exxon Mobil Corporation", "ExxonMobil Holdings Corp")).toBe(true);
  expect(sameCompanyName("Franklin Resources, Inc.", "FRANKLIN RESOURCES INC")).toBe(true);
  expect(sameCompanyName("Marathon Petroleum", "Marathon Digital Holdings")).toBe(false);
});
