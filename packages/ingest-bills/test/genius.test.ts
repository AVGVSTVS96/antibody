import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { amendmentStatus, attribute, versionStep } from "../src/amendments.ts";
import { parseBillStatus } from "../src/billstatus.ts";
import { amendmentFrom } from "../src/crec.ts";
import { isLate, trace } from "../src/lineage.ts";
import { parseSections } from "../src/sections.ts";
import { textVersions } from "../src/versions.ts";

/** Real GovInfo files for S.1582 (GENIUS Act) and its predecessor S.394, gzipped. */
const fixture = (name: string) =>
  new TextDecoder().decode(Bun.gunzipSync(readFileSync(join(import.meta.dir, "fixtures", `${name}.gz`))));

const status = parseBillStatus(fixture("BILLSTATUS-119s1582.xml"), "119-s-1582");
const refs = textVersions(status);
const versions = [
  { code: "s394-is", predecessor: true, secs: parseSections(fixture("BILLS-119s394is.xml")) },
  ...refs.map((r) => ({ code: r.code, predecessor: false, secs: parseSections(fixture(r.file)) })),
];
const { lineages, steps } = trace("119-s-1582", versions);
const sec19 = lineages.find((l) => l.id === "119-s-1582@es:sec:19")!;

test("BILLSTATUS: titles, sponsor, law and the four text versions in order", () => {
  expect(status.shortTitle).toBe("GENIUS Act");
  expect(status.sponsor).toBe("H000601");
  expect(status.cosponsors.map((c) => c.bioguide)).toContain("L000571");
  expect([status.law, status.lawOn]).toEqual(["P.L. 119-27", "2025-07-18"]);
  expect(refs.map((r) => [r.code, r.date])).toEqual([
    ["pcs", "2025-05-05"],
    ["es", "2025-06-17"],
    ["enr", "2025-07-17"],
    ["plaw", "2025-07-18"],
  ]);
  expect(refs.at(-1)!.url).toBe("https://www.govinfo.gov/content/pkg/PLAW-119publ27/uslm/PLAW-119publ27.xml");
});

test("lineage: 59/59 sections carried from committee text to law, one added on the Senate floor", () => {
  expect(steps.map((s) => [s.from, s.to, s.added, s.removed])).toEqual([
    ["s394-is", "pcs", 3, 0],
    ["pcs", "es", 1, 0],
    ["es", "enr", 0, 0],
    ["enr", "plaw", 0, 0],
  ]);
  expect(steps.slice(1).reduce((n, s) => n + Object.values(s.matched).reduce((a, b) => a + b, 0), 0)).toBe(59);
  expect(steps[2]!.matched).toEqual({ identical: 20 });
  expect(sec19.history.es!.heading).toBe("Disclosure relating to payment stablecoins");
  expect(sec19.last.text).toContain("aggregating $5,000 or less");
});

test("late: only sec. 19 (first in the Senate-passed text); predecessor and committee sections never", () => {
  expect(lineages.filter((l) => isLate(l, versions)).map((l) => l.id)).toEqual([sec19.id]);
});

test("sec. 19 came in through Hagerty's substitute SA 2307, read from its printed text", () => {
  const sa = status.amendments.find((a) => a.number === "2307")!;
  expect(amendmentStatus(sa)).toBe("agreed");
  const dated = refs.map((r) => ({ code: r.code, date: r.date }));
  const agreed = status.amendments.filter(
    (a) => amendmentStatus(a) === "agreed" && versionStep(a.latestAction!.date, dated) === "pcs->es",
  );
  expect(agreed.map((a) => a.number)).toEqual(["2307"]);
  const url = "https://www.govinfo.gov/content/pkg/CREC-2025-06-05/html/CREC-2025-06-05-pt1-PgS3259-5.htm";
  const rows = attribute({
    bill: "119-s-1582",
    from: "pcs",
    to: "es",
    agreed: [
      {
        rec: sa,
        when: "2025-06-12",
        text: { url, citation: null, text: amendmentFrom(fixture("CREC-2025-06-05-pt1-PgS3259-5.htm"), "2307") },
      },
    ],
    added: [sec19],
    removed: [],
    amended: new Map(),
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    amendment_id: "119-samdt-2307",
    section_id: sec19.id,
    how: "text",
    effect: "inserted",
    rests_on: ["amendments/119-samdt-2307", `sections/${sec19.id}`],
  });
  expect(rows[0]!.evidence.sourceUrl).toBe(url);
});
