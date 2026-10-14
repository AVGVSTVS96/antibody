import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBillStatus, parsePackage } from "../src/billstatus.ts";
import { digestJson, digestMarkdown, money, reasons } from "../src/digest.ts";
import { billEvents, closedRule, closedRuleBills, tally, voteClock } from "../src/events.ts";
import { lobbyingQuery } from "../src/lda.ts";
import { type Facts, score, subScores } from "../src/score.ts";
import { newSections, textShape } from "../src/text.ts";
import { candidate, type WatchResult, windowStart } from "../src/watch.ts";

const xml = await Bun.file(join(import.meta.dir, "fixtures/BILLSTATUS-119hr42.xml")).text();
const status = () => parseBillStatus(xml);

test("BILLSTATUS: bill, sponsor, versions newest first, CBO, substitute amendment", () => {
  const s = status();
  expect(s.id).toBe("119-hr-42");
  expect(s.shortTitle).toBe("Example Act");
  expect(s.sponsor).toMatchObject({ bioguide: "X000001", party: "I" });
  expect(s.versions.map((v) => v.code)).toEqual(["enr", "eas", "eh", "ih"]);
  expect(s.cbo[0]).toMatchObject({ url: "https://www.cbo.gov/publication/99999", publishedOn: "2026-09-04" });
  expect(s.amendments).toEqual([
    { id: "samdt3000", purpose: "In the nature of a substitute.", submittedOn: "2026-10-06" },
  ]);
  expect(s.laws).toEqual(["P.L. 119-99"]);
  expect(parsePackage("BILLS-119hjres12enr")).toEqual({ bill: "119-hjres-12", code: "enr" });
});

test("events: second-chamber passage with its tally and roll call, new text, law; introduced text is not movement", () => {
  const events = billEvents(status(), "2026-10-03", new Map([["BILLS-119hr42enr", "2026-10-09"]]));
  expect(events.map((e) => [e.step, e.date])).toEqual([
    ["law", "2026-10-09"],
    ["enrolled", "2026-10-09"],
    ["presented", "2026-10-08"],
    ["passed_second", "2026-10-07"],
    ["new_version", "2026-10-07"],
  ]);
  const vote = events.find((e) => e.step === "passed_second")!;
  expect(vote).toMatchObject({ kind: "floor_vote", tally: { yeas: 51, nays: 49 } });
  expect(vote.url).toContain("vote_119_2_00300.xml");
  expect(billEvents(status(), "2026-08-01").some((e) => e.text.startsWith("Introduced"))).toBe(false);
});

test("tallies read every chamber's wording", () => {
  expect(tally("On passage Passed by the Yeas and Nays: 308 - 122 (Roll no. 200).")).toEqual({ yeas: 308, nays: 122 });
  expect(tally("Agreed to by recorded vote: 217 - 212 (Roll no. 198).")).toEqual({ yeas: 217, nays: 212 });
  expect(tally("Passed Senate by Yea-Nay Vote. 68 - 30. Record Vote Number: 172.")).toEqual({ yeas: 68, nays: 30 });
  expect(tally("Passed Senate without amendment by Unanimous Consent.")).toBeNull();
});

test("closed rule: only the bills named before 'under a closed rule' count", () => {
  const genius =
    "Rule provides for consideration of H.R. 4016, H.R. 3633, H.R. 1919 and S. 1582. The resolution provides for consideration of H.R. 4016 and H.R. 3633 under a structured rule, and H.R. 1919 and S. 1582 under a closed rule, with one hour of general debate on each bill.";
  expect(closedRuleBills(genius, "119-s-1582")).toEqual(["119-hr-1919", "119-s-1582"]);
  expect(closedRule(status(), "2026-09-01")).toBe(true);
  expect(closedRule(status(), "2026-10-01")).toBe(false);
});

test("vote clock starts at introduction, or at a later substitute amendment", () => {
  const s = status();
  expect(voteClock(s, billEvents(s, "2026-09-01"))).toMatchObject({ days: 9, from: "introduced" });
  expect(voteClock(s, billEvents(s, "2026-10-01"))).toMatchObject({ days: 1, from: "samdt3000", voteOn: "2026-10-07" });
});

test("candidate: strongest step, closest vote, late measured against the first-passed text", () => {
  const c = candidate(status(), "2026-10-01")!;
  expect(c.facts).toMatchObject({ step: "law", closestVote: { yeas: 51, nays: 49 }, daysToVote: 1, closedRule: false });
  expect(c.evidence.newest?.code).toBe("enr");
  expect(c.evidence.passed?.code).toBe("eh");
  expect(candidate(status(), "2026-12-01")).toBeNull();
});

const facts: Facts = {
  step: "passed",
  words: 50_000,
  wordsCounted: true,
  deficitMusd: 100_000,
  lobbyingFilings: 99,
  lateSections: 4,
  daysToVote: 0,
  closedRule: false,
  closestVote: { yeas: 216, nays: 214 },
  buriedSections: 1,
};

test("sub-scores follow the published scales", () => {
  expect(subScores(facts)).toEqual({
    moving: 0.75,
    size: 0.63,
    dollars: 0.8,
    lobbying: 0.67,
    late: 0.4,
    rushed: 1,
    buried: 0.2,
    divisive: 1,
  });
  expect(score(subScores(facts))).toBe(66.4);
  const none = subScores({
    ...facts,
    words: null,
    deficitMusd: null,
    lobbyingFilings: null,
    lateSections: null,
    daysToVote: null,
    closestVote: null,
    buriedSections: null,
  });
  expect(none).toMatchObject({ size: null, dollars: null, rushed: null, divisive: null });
  expect(score(none)).toBe(15);
  expect(subScores({ ...facts, daysToVote: 30, closedRule: true }).rushed).toBe(0.5);
});

test("the sponsor's party never moves the score", () => {
  const parties = ["R", "D", "I"].map((party) => {
    const s = status();
    s.sponsor = { ...s.sponsor!, party };
    return candidate(s, "2026-09-01")!;
  });
  expect(new Set(parties.map((c) => c.score)).size).toBe(1);
  expect(new Set(parties.map((c) => JSON.stringify(reasons(c)))).size).toBe(1);
});

test("text shape skips sections quoted into existing law; renumbering is not a new section", () => {
  const sec = (n: string, h: string, body = "") =>
    `<section id="x"><enum>${n}</enum><header display-inline="yes">${h}</header>${body}</section>`;
  const before = textShape(`<bill>${sec("1.", "Short title")}${sec("2.", "Definitions")}</bill>`);
  const after = textShape(
    `<bill>${sec("1.", "Short title")}${sec("3.", "Definitions")}${sec("4.", "Exemption for <term>small</term> issuers", `<quoted-block>${sec("5.", "Quoted")}</quoted-block>`)}</bill>`,
  );
  expect(after.sections).toEqual(["1. Short title", "3. Definitions", "4. Exemption for small issuers"]);
  expect(newSections(before, after)).toEqual(["4. Exemption for small issuers"]);
});

test("lobbying search names every spelling of the number and the short title", () => {
  expect(lobbyingQuery("119-s-1582", "GENIUS Act")).toBe('"S. 1582" OR "S.1582" OR "GENIUS Act"');
  expect(lobbyingQuery("119-hr-1", null)).toBe('"H.R. 1" OR "H.R.1" OR "HR 1" OR "HR1" OR "H. R. 1"');
});

test("window starts at the last digest, never more than 14 days back, 3 days on a first run", async () => {
  const dir = await mkdtemp(join(tmpdir(), "watch-"));
  expect(await windowStart(dir, "2026-10-13")).toBe("2026-10-10");
  await writeFile(join(dir, "2026-10-11.json"), "{}");
  expect(await windowStart(dir, "2026-10-13")).toBe("2026-10-11");
  await rm(join(dir, "2026-10-11.json"));
  await writeFile(join(dir, "2026-08-01.json"), "{}");
  expect(await windowStart(dir, "2026-10-13")).toBe("2026-09-29");
  await rm(dir, { recursive: true });
});

test("digest: every reason links a source; party is shown only in the audit tally", () => {
  const c = candidate(status(), "2026-09-01")!;
  const r: WatchResult = {
    date: "2026-10-10",
    since: "2026-10-09",
    actionsSince: "2026-09-01",
    generatedAt: "2026-10-10T12:00:00.000Z",
    sources: [{ name: "test", url: "https://www.govinfo.gov/", ok: true, items: 1, error: null }],
    candidates: [c],
    alreadyReported: 0,
    xrayed: [],
    problems: [],
  };
  const d = digestJson(r);
  expect(d.flagged[0]!.reasons.length).toBeGreaterThan(2);
  for (const reason of d.flagged[0]!.reasons) expect(reason.url).toMatch(/^https:\/\//);
  expect(d.flaggedBySponsorParty).toEqual({ I: 1 });
  const md = digestMarkdown(d);
  expect(md).toContain("## 1. H.R.42 · Example Act");
  expect(md).toContain("Became law on Oct 9, 2026");
  expect(md).toContain("closed rule");
  expect(money(-149_000)).toBe("−$149.0B");
  expect(money(120)).toBe("+$120M");
});
