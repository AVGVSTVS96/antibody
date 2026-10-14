import { expect, test } from "bun:test";
import type { Row } from "@antibody/core";
import { baselineOf, parseListings, versionCode } from "../src/estimates.ts";
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

test("a group's members join by number only when the estimate's numbering is verified by its one-section rows", () => {
  const rows = [{ num: "112207", title: "Task force on the termination of Direct File" }];
  expect(sectionMap(bill, "eh", rows)("112210", "Some paraphrase of a whole group", true)).toBe("s-penalties");
  expect(
    sectionMap(bill, "eh", [{ num: "112207", title: "Unrelated" }])("112210", "Some paraphrase", true),
  ).toBeUndefined();
});
