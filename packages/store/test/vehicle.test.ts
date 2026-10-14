import { describe, expect, test } from "bun:test";
import { vehicleNote } from "../src/build.ts";
import { namesAnotherBill } from "../src/claims.ts";

const sponsor = { name: "Rep. Test" } as never;
const versions = (predecessor?: string) => [{ code: "ih", date: "2025-01-01", predecessor }] as never;
const sections = (first: string[]) => first.map((firstVersion) => ({ inFinal: true, firstVersion })) as never;

describe("vehicle bills", () => {
  test("a bill whose law text came from later versions is a vehicle", () => {
    const note = vehicleNote(null, versions(), sections(["ih", "eh", "eh", "enr"]), sponsor);
    expect(note).toContain("75% of the law's sections were not in the bill");
  });
  test("a bill mostly carried from its first text is not", () => {
    expect(vehicleNote(null, versions(), sections(["ih", "ih", "ih", "eh"]), sponsor)).toBeNull();
  });
  test("shell text with no late comparison is a vehicle", () => {
    expect(vehicleNote("shell", versions(), sections(["ih", "ih"]), sponsor)).not.toBeNull();
  });
  test("no sponsor or a predecessor version means no note", () => {
    expect(vehicleNote("shell", versions(), sections(["eh"]), undefined)).toBeNull();
    expect(vehicleNote("shell", versions("hr1"), sections(["eh"]), sponsor)).toBeNull();
  });
});

describe("counterpart references", () => {
  test("a filing naming another bill number is flagged", () => {
    expect(namesAnotherBill("H.R. 1234", "S.1582")).toBe(true);
    expect(namesAnotherBill("S.1582", "S.1582")).toBe(false);
    expect(namesAnotherBill("GENIUS Act", "S.1582")).toBe(false);
  });
});
