import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { amendmentStatus, versionStep } from "../src/amendments.ts";
import type { AmendmentRecord } from "../src/billstatus.ts";
import { candidates } from "../src/counterparts.ts";
import { amendmentFrom } from "../src/crec.ts";
import { wordDiff } from "../src/diff.ts";
import { cached } from "../src/fetch.ts";
import { trace } from "../src/lineage.ts";
import { match } from "../src/match.ts";
import { parseSections, type Sec } from "../src/sections.ts";
import { canon, citations, normEnum } from "../src/text.ts";

const bill = (body: string) => `<?xml version="1.0"?><bill><legis-body>${body}</legis-body></bill>`;
const section = (num: string, heading: string, text: string, id = "") =>
  `<section${id ? ` id="${id}"` : ""}><enum>${num}.</enum><header>${heading}</header><text>${text}</text></section>`;

const LOREM = (seed: string, n = 60) => Array.from({ length: n }, (_, i) => `${seed}${(i * 7919) % 101}`).join(" ");

describe("text", () => {
  test("canon and enums", () => {
    expect(canon("“Payment” stablecoins—½ of $5,000")).toBe("payment stablecoins 1 2 of 5 000");
    expect(normEnum("SEC. 70114.")).toBe("70114");
    expect(normEnum("TITLE VII—")).toBe("VII");
  });

  test("citations skip definition cross-references", () => {
    const t =
      "Section 45Y of the Internal Revenue Code of 1986 is amended. The term has the meaning given in section 3 of the Clean Air Act. See 42 U.S.C. 7401.";
    expect([...citations(t)].sort()).toEqual(["irc:45y", "usc:42:7401"]);
  });

  test("word diff counts inserted and removed words like difflib", () => {
    const d = wordDiff("the cap is 10000 dollars", "the cap is 40000 dollars for each return");
    expect(d).toEqual({ wordsAdded: 4, wordsRemoved: 1, largestInserts: ["for each return", "40000"] });
  });
});

describe("sections", () => {
  test("sections quoted into other law aren't the bill's own; deleted text stays out; containers build the path", () => {
    const secs = parseSections(
      bill(
        `<title><enum>I</enum><header>T</header>${section("101", "Credit", "Section 45 is amended.")}` +
          `<section><enum>102.</enum><header>Gone</header><text changed="deleted">old words</text><text>new words</text>` +
          `<quoted-block><section><enum>9.</enum><header>Inner</header><text>inside</text></section></quoted-block></section></title>`,
      ),
    );
    expect(secs.map((s) => [s.path, s.heading, s.text])).toEqual([
      ["title:I/sec:101", "Credit", "Section 45 is amended."],
      ["title:I/sec:102", "Gone", "new words 9 Inner inside"],
    ]);
  });
});

describe("match and lineage", () => {
  const v = (body: string, code: string) => ({ code, secs: parseSections(bill(body)), predecessor: false });

  test("a section that keeps its wording matches across renumbering; a new one is added", () => {
    const a = v(
      section("1", "Short title", "This Act may be cited as the X Act.") + section("2", "Grants", LOREM("g")),
      "ih",
    );
    const b = v(
      section("1", "Short title", "This Act may be cited as the X Act.") +
        section("2", "Disclosure", LOREM("d")) +
        section("3", "Grants", LOREM("g")),
      "es",
    );
    const { lineages, steps } = trace("119-s-1", [a, b]);
    expect(steps[0]!.matched).toEqual({ identical: 2 });
    const added = lineages.find((l) => l.firstVersion === "es")!;
    expect(added.id).toBe("119-s-1@es:sec:2");
    expect(lineages.find((l) => l.id === "119-s-1@ih:sec:2")!.history.es!.movedFrom).toBe("sec:2");
  });

  test("two sections that share a path in one version get distinct ids", () => {
    const a = v(section("2", "Grants", LOREM("g")) + section("2", "Nutrition", LOREM("n")), "rh");
    const { lineages } = trace("119-hr-1", [a]);
    expect(lineages.map((l) => l.id)).toEqual(["119-hr-1@rh:sec:2", "119-hr-1@rh:sec:2~2"]);
  });

  test("the old side of a split names its pieces", () => {
    const a = v(section("1", "Safety net", `${LOREM("s", 40)} ${LOREM("d", 40)}`), "pcs");
    const b = v(section("1", "Sugar", LOREM("s", 40)) + section("2", "Dairy", LOREM("d", 40)), "eas");
    const { lineages } = trace("119-hr-1", [a, b]);
    const old = lineages.find((l) => l.firstVersion === "pcs")!;
    expect(old.removedIn).toBeNull();
    const pieces = lineages.filter((l) => l.firstVersion === "eas");
    expect(old.splitInto).toEqual(pieces.map((p) => p.id));
    expect(pieces.every((p) => p.splitFrom?.id === old.id)).toBe(true);
  });

  test("a shared cited law alone doesn't make a same-law match", () => {
    const sec = (heading: string, text: string): Sec => parseSections(bill(section("1", heading, text)))[0]!;
    const water = sec("Large scale water reuse", `${LOREM("w")} under 43 U.S.C. 390b.`);
    const drought = sec("Drought mitigation", `${LOREM("q")} under 43 U.S.C. 390b.`);
    expect(match([water], [drought]).size).toBe(0);
    expect(match([water], [drought], { sameLawSimilarity: 0 }).get(0)?.method).toBe("same-law");
  });
});

describe("amendments", () => {
  const rec = (text: string | null): AmendmentRecord => ({
    type: "SAMDT",
    number: "1",
    congress: 119,
    chamber: "Senate",
    sponsorBioguide: "X000001",
    sponsorName: null,
    sponsorCommittee: null,
    purpose: null,
    latestAction: text ? { date: "2025-06-12", text } : null,
    actions: text ? [{ date: "2025-06-12", text, code: null, votes: [] }] : [],
    submittedOn: "2025-06-05",
    amends: null,
  });

  test("status comes from the latest action's words", () => {
    expect(amendmentStatus(rec("Amendment SA 2307 agreed to in Senate by Yea-Nay Vote. 67 - 30."))).toBe("agreed");
    expect(amendmentStatus(rec("Amendment SA 2851 not agreed to in Senate by Yea-Nay Vote."))).toBe("failed");
    expect(amendmentStatus(rec("Motion to table amendment SA 5 agreed to in Senate by Yea-Nay Vote."))).toBe("failed");
    expect(amendmentStatus(rec("Proposed amendment SA 2229 withdrawn in Senate."))).toBe("withdrawn");
    expect(amendmentStatus(rec(null))).toBe("no_action");
  });

  test("the version step brackets the last action", () => {
    const versions = [
      { code: "pcs", date: "2025-05-05" },
      { code: "es", date: "2025-06-17" },
      { code: "enr", date: null },
      { code: "plaw", date: "2025-07-18" },
    ];
    expect(versionStep("2025-06-12", versions)).toBe("pcs->es");
    expect(versionStep("2025-06-17", versions)).toBe("pcs->es");
    expect(versionStep("2025-04-01", versions)).toBeNull();
  });

  test("a Record page yields one amendment's text", () => {
    const html = `<pre>\n  SA 2814. Mrs. BLACKBURN proposed an amendment; as follows:\n\n        Strike section 40012.\n                                 ______\n\n  SA 2815. Mr. X submitted an amendment.\n</pre>`;
    expect(amendmentFrom(html, "2814")).toBe(
      "SA 2814. Mrs. BLACKBURN proposed an amendment; as follows:\n\n        Strike section 40012.",
    );
  });
});

test("counterpart candidates need a shared heading word, cited law or wording", () => {
  const { lineages } = trace("119-hr-1", [
    {
      code: "pcs",
      predecessor: false,
      secs: parseSections(
        bill(section("10002", "Able bodied adults without dependents work requirements", LOREM("a"))),
      ),
    },
    {
      code: "eas",
      predecessor: false,
      secs: parseSections(
        bill(
          section("10102", "Modifications to SNAP work requirements for able-bodied adults", LOREM("b")) +
            section("50101", "Wool research", LOREM("c")),
        ),
      ),
    },
  ]);
  const removed = lineages.find((l) => l.firstVersion === "pcs")!;
  const added = lineages.filter((l) => l.firstVersion === "eas");
  expect(candidates(removed, added).map((l) => l.last.heading)).toEqual([
    "Modifications to SNAP work requirements for able-bodied adults",
  ]);
});

test("cached: two downloads of one file at once both land", async () => {
  using server = Bun.serve({ port: 0, fetch: () => new Response("<mods/>") });
  const dir = await mkdtemp(join(tmpdir(), "antibody-cached-"));
  const url = `http://localhost:${server.port}/mods.xml`;
  expect(await Promise.all([cached(url, "mods.xml", true, dir), cached(url, "mods.xml", true, dir)])).toEqual([
    "<mods/>",
    "<mods/>",
  ]);
  expect(await readdir(dir)).toEqual(["mods.xml"]);
});
