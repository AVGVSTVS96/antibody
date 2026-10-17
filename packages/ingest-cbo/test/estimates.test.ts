import { expect, test } from "bun:test";
import type { Row } from "@antibody/core";
import { baselineOf, companions, parseListings, versionCode } from "../src/estimates.ts";
import { sectionMap } from "../src/sections.ts";

const xml = `<billStatus><bill><cboCostEstimates>
  <item><pubDate>2025-07-21T18:15:00Z</pubDate>
    <title>Estimated Budgetary Effects of Public Law 119-21, Relative to the Budget Enforcement Baseline for Consideration in the Senate</title>
    <url>https://www.cbo.gov/publication/61569</url><description>Public Law 119-21 as enacted on July 4, 2025</description></item>
  <item><pubDate>2025-07-21T18:29:00Z</pubDate>
    <title>Estimated Budgetary Effects of Public Law 119-21, Relative to CBO&#039;s January 2025 Baseline</title>
    <url>https://www.cbo.gov/publication/61570</url><description>Public Law 119-21 as enacted on July 4, 2025</description></item>
</cboCostEstimates></bill></billStatus>`;

test("BILLSTATUS lists each CBO publication once, with the version it scored", () => {
  const twice = xml.replace("</cboCostEstimates>", `${xml.match(/<item>[\s\S]*?<\/item>/)![0]}</cboCostEstimates>`);
  expect(parseListings(twice).map((l) => l.pubId)).toEqual(["61569", "61570"]);
  const [beb, clb] = parseListings(xml);
  expect(beb).toMatchObject({ pubId: "61569", description: "Public Law 119-21 as enacted on July 4, 2025" });
  expect(clb!.title).toContain("CBO's January 2025 Baseline");
});

test("every estimate names its baseline", () => {
  const [beb, clb] = parseListings(xml);
  expect(baselineOf(beb!, null)).toEqual({
    baseline: "current-policy",
    label: "Senate budget-enforcement baseline (current policy)",
  });
  expect(baselineOf(clb!, null)).toEqual({ baseline: "current-law", label: "CBO January 2025 baseline (current law)" });
  expect(baselineOf({ ...clb!, title: "S. 1582, GENIUS Act" }, null).label).toBe("CBO current-law baseline");
});

test("CBO's description maps to a GovInfo version code", () => {
  expect(versionCode("As passed by the Senate on June 17, 2025", "119-s-1582")).toBe("es");
  expect(versionCode("As passed by the House of Representatives on May 22, 2025", "119-hr-1")).toBe("eh");
  expect(versionCode("Public Law 119-21 as enacted on July 4, 2025", "119-hr-1")).toBe("enr");
  expect(versionCode("As ordered reported by the Senate Committee on Banking on March 13, 2025", "119-s-1582")).toBe(
    "rs",
  );
  expect(
    versionCode("As posted on the website of the Senate Committee on the Budget on June 27, 2025", "119-hr-1"),
  ).toBe(null);
  expect(versionCode("As passed by the Senate on June 17, 2025", "119-s-1582", ["is", "rs", "enr"])).toBe(null);
});

const section = (id: string, history: Record<string, { path: string; heading: string }>) =>
  ({ id, history }) as unknown as Row<"sections">;

const bill = [
  section("s-direct-file", {
    rh: { path: "title:XI/sec:112207", heading: "Task force on the termination of Direct File" },
    eh: { path: "title:XI/sec:112206", heading: "Task force on the termination of Direct File" },
  }),
  section("s-penalties", {
    rh: {
      path: "title:XI/sec:112210",
      heading: "Increase in penalties for unauthorized disclosures of taxpayer information",
    },
    eh: {
      path: "title:XI/sec:112207",
      heading: "Increase in penalties for unauthorized disclosures of taxpayer information",
    },
  }),
];

test("CBO section numbers join through the scored version's path, not the final number", () => {
  const map = sectionMap(
    [
      section("s1", {
        eh: { path: "title:XI/subtitle:A/sec:110001", heading: "Medicaid work requirements" },
        enr: { path: "title:VII/subtitle:A/chapter:1/sec:70101", heading: "Medicaid work requirements" },
      }),
    ],
    "enr",
  );
  expect(map("70101", "Medicaid work requirements")).toBe("s1");
  expect(map("110001", "Medicaid work requirements")).toBe("s1");
  expect(map("999", "Medicaid work requirements")).toBeUndefined();
});

test("a number whose section has a different heading stays unjoined (CBO 112207 is Direct File, not the penalties section numbered 112207 in eh)", () => {
  const map = sectionMap(bill, "eh", [{ num: "112207", title: "Task force on the termination of Direct File" }]);
  expect(map("112207", "Task force on the termination of Direct File")).toBe("s-direct-file");
  expect(map("112207", "Inspector General")).toBeUndefined();
});

const related = (title: string, type: string, number: number, relation: string, congress = 117) =>
  `<item><title>${title}</title><congress>${congress}</congress><number>${number}</number><type>${type}</type>
    <latestAction><actionDate>2022-06-16</actionDate><text>Message on Senate action sent to the House.</text></latestAction>
    <relationshipDetails><item><type>${relation}</type><identifiedBy>CRS</identifiedBy></item></relationshipDetails></item>`;

test("bills that carried the same text: identical bills, public laws that contain it, and related bills with its short title", () => {
  const status = `<billStatus><bill>
    <relatedBills>
      ${related("Honoring our PACT Act of 2022", "HR", 3967, "Related bill")}
      ${related("Build a Better VA Act", "HR", 913, "Related bill")}
      ${related("A bill with the same words", "S", 77, "Identical bill")}
      ${related("Another vehicle", "HR", 29, "Public law contains the text")}
      ${related("Honoring our PACT Act of 2022", "HR", 3967, "Related bill", 116)}
      ${related("Honoring our PACT Act of 2022", "HRES", 1224, "Related bill")}
      ${related("TEAM Act of 2022", "HR", 55, "Related bill")}
    </relatedBills>
    <titles>
      <item><titleType>Short Titles as Enacted</titleType><title>Honoring our PACT Act of 2022</title></item>
      <item><titleType>Other Short Titles for portions of a bill</titleType><title>TEAM Act of 2022</title></item>
      <item><titleType>Official Title as Introduced</titleType><title>Build a Better VA Act</title></item>
    </titles></bill></billStatus>`;
  expect(companions(status, "117-s-3373")).toEqual(["117-hr-3967", "117-s-77", "117-hr-29"]);
});

test("a group's members join by number only when the estimate's numbering is verified by its one-section rows", () => {
  const rows = [{ num: "112207", title: "Task force on the termination of Direct File" }];
  expect(sectionMap(bill, "eh", rows)("112210", "Some paraphrase of a whole group", true)).toBe("s-penalties");
  expect(
    sectionMap(bill, "eh", [{ num: "112207", title: "Unrelated" }])("112210", "Some paraphrase", true),
  ).toBeUndefined();
});
