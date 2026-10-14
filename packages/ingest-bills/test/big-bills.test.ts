import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { RAW } from "../src/fetch.ts";
import { ingestBill } from "../src/ingest.ts";

/**
 * H.R.1 (OBBBA, 119th, Republican-led) and H.R.5376 (IRA, 117th, Democrat-led) are 2-4 MB per version, so they run
 * against the GovInfo downloads in data/bills/raw when they're there (the server), and skip in CI.
 */
const have = (...files: string[]) => files.every((f) => existsSync(join(RAW, f)));
const run = (id: "119-hr-1" | "117-hr-5376") => ingestBill(id, { write: false, llm: false });

const hr1 = have("BILLSTATUS-119hr1.xml", "BILLS-119hr1eas.xml", "PLAW-119publ21.xml") ? await run("119-hr-1") : null;
const ira = have("BILLSTATUS-117hr5376.xml", "BILLS-117hr5376eas.xml", "PLAW-117publ169.xml")
  ? await run("117-hr-5376")
  : null;

describe.skipIf(!hr1)("H.R.1", () => {
  const { versions, lineages, steps, rows } = hr1!;
  const byId = new Map(lineages.map((l) => [l.id, l]));
  const sections = new Map(rows.sections!.map((s) => [s.id, s]));

  test("six versions, House text to law", () => {
    expect(versions.map((v) => v.code)).toEqual(["rh", "eh", "pcs", "eas", "enr", "plaw"]);
    expect(steps.map((s) => [s.from, s.to, s.added])).toEqual([
      ["rh", "eh", 6],
      ["eh", "pcs", 0],
      ["pcs", "eas", 121],
      ["eas", "enr", 0],
      ["enr", "plaw", 0],
    ]);
    expect(steps[2]!.addedSplitFromOld).toBe(33);
  });

  test("the House 'Safety net' section says it was split into the Senate's 21 pieces", () => {
    const net = sections.get("119-hr-1@rh:title:I/subtitle:B/sec:10101")!;
    expect([net.removed_in, net.split_into.length]).toEqual(["eas", 21]);
  });

  test("gambling losses: House 110014 is the Senate's rewritten 70114", () => {
    const l = byId.get("119-hr-1@rh:title:XI/subtitle:A/part:1/sec:110014")!;
    expect(l.history.eas).toMatchObject({ path: "title:VII/subtitle:A/chapter:1/sec:70114", match: "rewritten" });
    expect(l.last.text).toContain("90 percent");
  });

  test("late in the final law: 4 from the House floor, 112 from the Senate", () => {
    const late = rows.sections!.filter((s) => s.in_final && s.late);
    expect(late.filter((s) => s.first_version === "eh")).toHaveLength(4);
    expect(late.filter((s) => s.first_version === "eas")).toHaveLength(112);
  });

  test("who offered it: Ernst's millionaire-unemployment section, Blackburn's AI strike, the Rules Committee print", () => {
    const by = (amendment: string) => rows.amendment_sections!.filter((r) => r.amendment_id === amendment);
    expect(by("119-samdt-2372").map((r) => [sections.get(r.section_id)!.heading, r.how, r.effect])).toEqual([
      ["Ending unemployment payments to jobless millionaires", "text", "inserted"],
    ]);
    expect(by("119-samdt-2814").map((r) => [r.section_id, r.effect])).toEqual([
      ["119-hr-1@rh:title:IV/subtitle:C/part:2/sec:43201", "struck"],
    ]);
    expect(by("119-hamdt-22")).toHaveLength(6);
    const rules = rows.amendments!.find((a) => a.id === "119-hamdt-22")!;
    expect([rules.sponsor_bioguide, rules.sponsor_committee, rules.version_step]).toEqual([null, "HSRU", "rh->eh"]);
    const sa = rows.amendments!.find((a) => a.id === "119-samdt-2848")!;
    expect([sa.sponsor_bioguide, sa.status, sa.roll_id]).toEqual(["G000359", "agreed", "senate-119-1-370"]);
  });
});

describe.skipIf(!ira)("IRA", () => {
  const { lineages, rows } = ira!;
  const sections = new Map(rows.sections!.map((s) => [s.id, s]));

  test("the $4B drought section is a late Senate add, no longer hidden by a same-law match", () => {
    const drought = sections.get("117-hr-5376@eas:title:V/subtitle:B/part:3/sec:50233")!;
    expect(drought.heading).toContain("Drought mitigation");
    expect([drought.first_version, drought.late, drought.in_final]).toEqual(["eas", true, true]);
    expect(sections.get("117-hr-5376@eas:title:V/subtitle:A/part:2/sec:50123")!.first_version).toBe("eas");
  });

  test("every same-law match keeps at least 0.15 text similarity", () => {
    const sameLaw = lineages.flatMap((l) => Object.values(l.history).filter((s) => s.match === "same-law"));
    expect(sameLaw.length).toBeGreaterThan(0);
    expect(sameLaw.every((s) => s.similarity! >= 0.15)).toBe(true);
  });

  test("final law has 153 sections; Senate adds are tied to Schumer's substitute SA 5194 by its printed text", () => {
    expect(rows.sections!.filter((s) => s.in_final)).toHaveLength(153);
    const sa = rows.amendment_sections!.filter((r) => r.amendment_id === "117-samdt-5194" && r.how === "text");
    expect(sa.length).toBeGreaterThanOrEqual(18);
    expect(sa.map((r) => r.section_id)).toContain("117-hr-5376@eas:title:V/subtitle:B/part:3/sec:50233");
  });
});
