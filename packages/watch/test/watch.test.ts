import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BillId, Row } from "@antibody/core";
import { parseBillStatus, parsePackage } from "../src/billstatus.ts";
import type { Action, TextVersion } from "../src/billstatus.ts";
import { deficitEffect, digestJson, digestMarkdown, money, reasons } from "../src/digest.ts";
import {
  beforeFloor,
  billEvents,
  classify,
  closedRule,
  closedRuleBills,
  tally,
  voteClock,
  voteQuestion,
} from "../src/events.ts";
import type { Step, Tally } from "../src/events.ts";
import { lobbyingQuery } from "../src/lda.ts";
import { score, subScores } from "../src/score.ts";
import type { Facts } from "../src/score.ts";
import { newSections, textShape } from "../src/text.ts";
import { candidate, toXray, windowStart } from "../src/watch.ts";
import type { Candidate, WatchResult } from "../src/watch.ts";

const xml = await Bun.file(join(import.meta.dir, "fixtures/BILLSTATUS-119hr42.xml")).text();
const status = () => parseBillStatus(xml);

function defined<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`expected ${what}`);
  }

  return value;
}

const shortTitleWith = (items: [string, string][]) =>
  parseBillStatus(
    xml.replace(
      /<titles>[\s\S]*?<\/titles>/u,
      `<titles>${items.map(([type, title]) => `<item><titleType>${type}</titleType><title>${title}</title></item>`).join("")}</titles>`,
    ),
  ).shortTitle;

const sec = (n: string, h: string, body = "") =>
  `<section id="x"><enum>${n}</enum><header display-inline="yes">${h}</header>${body}</section>`;

const moved = (bill: string, party: string, points: number, flagged: boolean) => ({
  bill,
  party,
  score: points,
  flagged,
});

const action = (text: string, type = "Floor"): Action => ({ date: "2026-10-15", text, type, code: null, votes: [] });

const scored = (id: BillId, points: number, step: Step = "passed", closestVote: Tally | null = null): Candidate => {
  const c = defined(candidate(status(), "2026-09-01"), "a candidate");
  c.status.id = id;
  c.score = points;
  c.facts.step = step;
  c.facts.closestVote = closestVote;

  return c;
};

const filingUrl = (id: string) => `https://lda.gov/filings/public/filing/${id}/print/`;

const billRef = (n: number): Row<"lda_bill_refs"> => ({
  id: `f${n}#0#119-hr-9`,
  filing_id: `f${n}`,
  bill_id: "119-hr-9",
  line: 0,
  section_nums: [],
  issue_code: "FIN",
  quote: "H.R. 9",
  matched: "H.R. 9",
  how: "number",
  match: "high",
  why: "cites the number",
  phase: "bill",
  source_url: filingUrl(`f${n}`),
  source_locator: null,
});

const filing = (id: string, clientKey: string, year: number): Row<"lda_filings"> => ({
  id,
  url: filingUrl(id),
  api_url: `https://lda.gov/api/v1/filings/${id}/`,
  form: "LD-2",
  type: "Q1",
  year,
  period: "first_quarter",
  period_start: `${year}-01-01`,
  period_end: `${year}-03-31`,
  posted_at: null,
  registrant_id: "r1",
  registrant_name: "Registrant",
  client_key: clientKey,
  lda_client_id: clientKey,
  client_name: clientKey,
  client_description: null,
  amount_usd: null,
  amount_kind: null,
  issue_lines: 1,
  superseded: false,
  source_url: filingUrl(id),
  source_locator: null,
});

const ruleStatus = () => {
  const s = status();
  s.id = "119-hres-211";
  s.title = "Providing for consideration of the joint resolution (H.J. Res. 25) and for other purposes.";

  return s;
};

const textFixture = async (code: string) =>
  await Bun.file(join(import.meta.dir, `fixtures/BILLS-119hr7008${code}.xml`)).text();

const version = (code: string, date: string | null): TextVersion => ({
  code,
  name: code,
  date,
  xmlUrl: `https://x/${code}.xml`,
});

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

test("short title: a title for portions of the bill (H.R.1's \"FEHB Protection Act\") is never the bill's own", () => {
  const portion: [string, string] = [
    "Short Titles as Enacted for portions of this bill",
    "FEHB Protection Act of 2025",
  ];

  expect(shortTitleWith([portion, ["Popular Titles", "One Big Beautiful Bill Act"]])).toBe(
    "One Big Beautiful Bill Act",
  );
  expect(shortTitleWith([["Short Title(s) as Passed House", "One Big Beautiful Bill Act"]])).toBe(
    "One Big Beautiful Bill Act",
  );
  expect(shortTitleWith([portion])).toBeNull();
  expect(
    shortTitleWith([
      [
        "Short Titles for portions of this bill from ENR (Enrolled) bill text",
        "Israel Security Supplemental Appropriations Act, 2024",
      ],
      ["Short Title(s) as Passed House", "RELIEVE Act"],
    ]),
  ).toBeNull();
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

  const vote = defined(
    events.find((e) => e.step === "passed_second"),
    "a second-chamber passage",
  );

  expect(vote).toMatchObject({ kind: "floor_vote", tally: { yeas: 51, nays: 49 } });
  expect(vote.url).toContain("vote_119_2_00300.xml");
  expect(billEvents(status(), "2026-08-01").some((e) => e.text.startsWith("Introduced"))).toBe(false);
});

test("tallies read every chamber's wording", () => {
  expect(tally("On passage Passed by the Yeas and Nays: 308 - 122 (Roll no. 200).")).toEqual({ yeas: 308, nays: 122 });
  expect(tally("Agreed to by recorded vote: 217 - 212 (Roll no. 198).")).toEqual({ yeas: 217, nays: 212 });
  expect(
    tally(
      "On motion to suspend the rules and pass the bill, as amended Agreed to by the Yeas and Nays: (2/3 required): 267 - 117 (Roll no. 228).",
    ),
  ).toEqual({ yeas: 267, nays: 117 });
  expect(voteQuestion("On motion to commit Failed by the Yeas and Nays: 209 - 216 (Roll no. 319).")).toBe(
    "On motion to commit Failed",
  );
  expect(voteQuestion("Agreed to by recorded vote: 217 - 212 (Roll no. 198).")).toBe("Agreed to");
  expect(
    voteQuestion(
      "On motion to suspend the rules and pass the bill Agreed to by the Yeas and Nays: (2/3 required): 267 - 117",
    ),
  ).toBe("On motion to suspend the rules and pass the bill Agreed to");
  expect(voteQuestion("Passed Senate without amendment by Yea-Nay Vote. 77 - 20. Record Vote Number: 280.")).toBe(
    "Passed Senate without amendment",
  );
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

test("candidate: strongest step, closest vote and haste over the bill's whole record, late against the first-passed text", () => {
  const c = defined(candidate(status(), "2026-10-01"), "a candidate");
  expect(c.facts).toMatchObject({
    step: "law",
    closestVote: { yeas: 216, nays: 214 },
    daysToVote: 9,
    closedRule: true,
  });
  expect(c.evidence.newest?.code).toBe("enr");
  expect(c.evidence.before?.code).toBe("ih");
  expect(candidate(status(), "2026-12-01")).toBeNull();
});

test("new events decide which bills are looked at; the score is the bill's own, not the window's", () => {
  const law = "119-hr-42/action/2026-10-09/law";
  const c = defined(candidate(status(), "2026-10-01", undefined, new Set([law])), "a candidate");
  expect(c.facts.step).toBe("law");
  expect(c.fresh.has(law)).toBe(false);
  expect(reasons(c)[0]?.text).toBe("Became law on Oct 9, 2026; new: went to the President on Oct 8, 2026");
  expect(c.score).toBe(defined(candidate(status(), "2026-10-01"), "a candidate").score);
  const everything = billEvents(status(), "2026-10-01").map((e) => e.id);
  expect(candidate(status(), "2026-10-01", undefined, new Set(everything))).toBeNull();
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
  newsStories: 99,
};

test("sub-scores follow the published scales", () => {
  expect(subScores(facts)).toEqual({
    moving: 0.75,
    attention: 0.67,
    size: 0.63,
    dollars: 0.8,
    lobbying: 0.67,
    late: 0.4,
    rushed: 1,
    buried: 0.2,
    divisive: 1,
  });
  expect(score(subScores(facts))).toBe(69.7);

  const none = subScores({
    ...facts,
    words: null,
    deficitMusd: null,
    lobbyingFilings: null,
    lateSections: null,
    daysToVote: null,
    closestVote: null,
    buriedSections: null,
    newsStories: null,
  });

  expect(none).toMatchObject({ attention: null, size: null, dollars: null, rushed: null, divisive: null });
  expect(score(none)).toBe(11.2);
  expect(subScores({ ...facts, daysToVote: 30, closedRule: true }).rushed).toBe(0.5);
});

test("the sponsor's party never moves the score", () => {
  const parties = ["R", "D", "I"].map((party) => {
    const s = status();
    s.sponsor = { ...defined(s.sponsor, "a sponsor"), party };

    return defined(candidate(s, "2026-09-01"), "a candidate");
  });

  expect(new Set(parties.map((c) => c.score)).size).toBe(1);
  expect(new Set(parties.map((c) => JSON.stringify(reasons(c)))).size).toBe(1);
});

test("text shape skips sections quoted into existing law; renumbering is not a new section", () => {
  const before = textShape(`<bill>${sec("1.", "Short title")}${sec("2.", "Definitions")}</bill>`);

  const after = textShape(
    `<bill>${sec("1.", "Short title")}${sec("3.", "Definitions")}${sec("4.", "Exemption for <term>small</term> issuers", `<quoted-block>${sec("5.", "Quoted")}</quoted-block>`)}</bill>`,
  );

  expect(after.sections).toEqual(["1. Short title", "3. Definitions", "4. Exemption for small issuers"]);
  expect(newSections(before, after)).toEqual(["4. Exemption for small issuers"]);
  const toc = textShape(`<bill>${sec("1.", "Short title; table of contents")}${sec("2.", "Definitions")}</bill>`);
  expect(newSections(before, toc)).toEqual([]);
});

test("lobbying search names every spelling of the number and never the short title", () => {
  expect(lobbyingQuery("119-s-1582")).toBe('"S. 1582" OR "S.1582"');
  expect(lobbyingQuery("119-hr-1")).toBe('"H.R. 1" OR "H.R.1" OR "HR 1" OR "HR1" OR "H. R. 1"');
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
  const c = defined(candidate(status(), "2026-09-01"), "a candidate");

  const r: WatchResult = {
    date: "2026-10-10",
    since: "2026-10-09",
    actionsSince: "2026-09-01",
    generatedAt: "2026-10-10T12:00:00.000Z",
    sources: [{ name: "test", url: "https://www.govinfo.gov/", ok: true, items: 1, error: null }],
    candidates: [c],
    alreadyReported: 0,
    xrayed: [],
    site: { published: [], deploy: { status: "disabled", reason: "test" } },
    problems: [],
  };

  const d = digestJson(r);
  const [top] = d.flagged;
  expect(top?.reasons.length).toBeGreaterThan(2);

  for (const reason of top?.reasons ?? []) {
    expect(reason.url).toMatch(/^https:\/\//u);
  }

  expect(d.flaggedBySponsorParty).toEqual({ I: 1 });
  const md = digestMarkdown(d);
  expect(md).toContain("## 1. H.R.42 · Example Act");
  expect(md).toContain("Became law on Oct 9, 2026");
  expect(md).toContain("closed rule");
  expect(md).toContain("Site: no new bundles published · not deployed (turned off)");
  expect(md).toContain("page: not published yet");

  const lobbied = (clients: number) => {
    c.facts.lobbyingFilings = 16;
    c.evidence.lobbyingFrom = "x-ray";
    c.evidence.lobbyingClients = clients;

    return digestJson(r).flagged[0]?.reasons.find((x) => x.signal === "lobbying")?.text;
  };

  expect(lobbied(1)).toBe("16 lobbying filings name it (1 client)");
  expect(lobbied(11)).toBe("16 lobbying filings name it (11 clients)");
  expect(money(-149_000)).toBe("−$149.0B");
  expect(money(120)).toBe("+$120M");
});

test("a lobbying line counts only when it cites this bill's exact number in its own Congress", async () => {
  const { citesBill } = await import("../src/lda.ts");
  expect(citesBill("Stablecoin regulation, S. 1582 (GENIUS Act)", "119-s-1582")).toBe(true);
  expect(citesBill("H.R. 1319 American Rescue Plan", "117-hr-1")).toBe(false);
  expect(citesBill("S. 15820", "119-s-1582")).toBe(false);
  expect(citesBill("H.R. 1 (118th Congress) Limit, Save, Grow", "119-hr-1")).toBe(false);
  expect(citesBill("H.R.1 One Big Beautiful Bill, 119th Congress", "119-hr-1")).toBe(true);
});

test("party audit: a bill counts once across days, and equal flag rates show no gap", async () => {
  const { auditParties } = await import("../src/audit.ts");

  const a = auditParties([
    [moved("a", "R", 10, false), moved("b", "D", 30, true)],
    [moved("a", "R", 40, true), moved("c", "D", 5, false), moved("d", "R", 3, false)],
  ]);

  expect(a.bills).toBe(4);
  expect(a.parties.find((p) => p.party === "R")).toMatchObject({ moved: 2, flagged: 1, meanScore: 21.5 });
  expect(a.parties.find((p) => p.party === "D")).toMatchObject({ moved: 2, flagged: 1 });
  expect(a.z).toBe(0);
  expect(a.verdict).toContain("too few");
});

test("only bills at the cutoff are flagged", async () => {
  const { flaggedOf } = await import("../src/digest.ts");
  const bills = [40, 25, 24.9, 19].map((points) => scored("119-hr-1", points));
  expect(flaggedOf(bills).length).toBe(2);
  expect(flaggedOf([scored("119-hr-1", 5)]).length).toBe(0);
});

test("a day's digest flags at most 25 bills; a sweep of a whole Congress flags every bill at the cutoff", async () => {
  const { flaggedOf, flagCap } = await import("../src/digest.ts");
  const many = Array.from({ length: 30 }, () => scored("119-hr-1", 30));
  expect(flaggedOf(many, flagCap({})).length).toBe(25);
  expect(flaggedOf(many, flagCap({ sweep: 119 })).length).toBe(30);
});

test("a Senate referral recorded as a floor action is not floor action", () => {
  const referral =
    "Under authority of the order of the Senate of September 30, 2026, ordered read twice and referred to the Committee on Foreign Relations.";

  expect(classify(action(referral), new Set())).toBeNull();
  expect(classify(action("Read twice and referred to the Committee on Finance."), new Set())).toBeNull();
  expect(classify(action("Motion to proceed to consideration of measure made in Senate."), new Set())).toBe("floor");
});

test("'Passed Senate …' counts as passing a chamber, once, next to its 'Passed/agreed to' twin", () => {
  const plain = "Passed Senate without amendment by Unanimous Consent. (consideration: CR S5186)";
  const twin = `Passed/agreed to in Senate: ${plain}`;
  expect(classify(action(plain), new Set())).toBe("passed");
  expect(classify(action("Passed Senate with an amendment by Voice Vote."), new Set())).toBe("passed");
  expect(classify(action(plain), new Set(["House"]))).toBe("passed_second");
  expect(classify(action(twin), new Set())).toBe("passed");

  const s = {
    ...status(),
    versions: [],
    cbo: [],
    actions: [plain, twin].map((text) => action(text)),
  };

  expect(billEvents(s, "2026-10-01").map((e) => e.step)).toEqual(["passed"]);
});

test("the x-ray's lobbying client count reads lda_filings, which is sharded by year, not by bill", async () => {
  const dir = await mkdtemp(join(tmpdir(), "antibody-xray-"));

  try {
    const write = async (table: string, shard: string, rows: object[]) => {
      await mkdir(join(dir, "out", table), { recursive: true });
      await writeFile(join(dir, "out", table, `${shard}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n"));
    };

    await write("lda_bill_refs", "119-hr-9", [billRef(1), billRef(2), billRef(3)]);
    await write("lda_filings", "2025", [
      filing("f1", "acme", 2025),
      filing("f2", "acme", 2025),
      filing("other", "unrelated", 2025),
    ]);
    await write("lda_filings", "2026", [filing("f3", "globex", 2026)]);
    const code = `import { xrayFacts } from "./packages/watch/src/xray.ts"; console.log(JSON.stringify((await xrayFacts("119-hr-9")).lobbying))`;

    const run = Bun.spawn(["bun", "-e", code], {
      cwd: join(import.meta.dir, "../../.."),
      env: { ...process.env, ANTIBODY_DATA: dir },
      stdout: "pipe",
    });

    expect(JSON.parse(await new Response(run.stdout).text())).toEqual({ filings: 3, clients: 2 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("only flagged bills are x-rayed and published, best first, never padded up to the count", () => {
  const picked = toXray(
    [scored("119-hr-1", 14.1), scored("119-hr-2", 31.2), scored("119-hr-3", 25), scored("119-hr-4", 24.9)],
    3,
  );

  expect(picked.map((c) => c.status.id)).toEqual(["119-hr-2", "119-hr-3"]);
  expect(toXray([scored("119-hr-5", 14.1), scored("119-hr-6", 13.8)], 3)).toEqual([]);
});

test("a deficit figure reads in plain words, and a rounding error is no measurable effect", () => {
  expect(deficitEffect(0)).toBe("no measurable effect on the deficit");
  expect(deficitEffect(120)).toBe("adds $120M to the deficit");
  expect(deficitEffect(-3400)).toBe("cuts the deficit by $3.4B");
});

test("news attention weighs the left, center and right of the outlet list equally, whatever their outlet counts", async () => {
  const { COUNTED, SIDES } = await import("@antibody/ingest-news");
  const { newsWindow, weighSides } = await import("../src/news.ts");

  const on = (side: keyof typeof SIDES) =>
    COUNTED.filter((o) => o.mediacloud_id !== null && o.mediacloud_id !== 0 && SIDES[side].some((g) => g === o.group));

  const [left, center, right] = [on("left"), on("center"), on("right")];
  const total = left.length + center.length + right.length;
  const even = Object.fromEntries([...left, ...center, ...right].map((o) => [o.domain, 1]));
  expect(weighSides(even)).toEqual({
    bySide: { left: left.length, center: center.length, right: right.length },
    stories: total,
  });
  const oneSide = weighSides({ [defined(right[0], "a right-side outlet").domain]: right.length * 3 });
  expect(oneSide.stories).toBe(total);
  expect(weighSides({ "example.com": 50 }).stories).toBe(0);

  const s = status();
  expect(newsWindow(s, "2026-10-21")).toEqual({ start: "2026-08-25", end: "2026-10-21" });

  const dormant = {
    ...s,
    actions: s.actions.filter((a) => !/Became (Public|Private) Law/u.test(a.text) && a.type !== "BecameLaw"),
  };

  const lastAction = defined(
    dormant.actions
      .map((a) => a.date)
      .toSorted()
      .at(-1),
    "a last action",
  );

  const end = new Date(Date.parse(lastAction) + 30 * 86_400_000).toISOString().slice(0, 10);
  expect(newsWindow(dormant, "2027-06-01").end).toBe(end);
  expect(newsWindow(dormant, "2028-01-01").end).toBe(end);
  expect(newsWindow(s, "2027-06-01")).toEqual({ start: "2026-08-25", end: "2026-11-08" });
});

test("a sweep starts at the first day of its Congress", async () => {
  const { congressStart } = await import("../src/sweep.ts");
  expect(congressStart(119)).toBe("2025-01-03");
  expect(congressStart(117)).toBe("2021-01-03");
});

const rule = async (n: number) => await Bun.file(join(import.meta.dir, `fixtures/rules/BILLS-119hres${n}.xml`)).text();

test("rule riders: sections of a House rule that do more than set up debate, by their wording", async () => {
  const { ruleRiders } = await import("../src/rules.ts");
  const kinds = async (n: number) => ruleRiders(await rule(n)).map((r) => `${r.kind}@${r.section}`);
  expect(await kinds(211)).toEqual(["clock@4"]);
  expect(ruleRiders(await rule(211))[0]?.quote).toStartWith(
    "Each day for the remainder of the first session of the 119th Congress shall not constitute a calendar day",
  );
  expect(await kinds(590)).toEqual(["deem@1"]);
  expect(await kinds(707)).toEqual(["engross@7", "amend@8", "amend@9", "amend@10", "clock@11"]);
  expect(await kinds(1224)).toEqual(["engross@8", "engross@11"]);
  expect(await kinds(294)).toEqual(["deem@5", "table@6"]);
  expect(await kinds(282)).toEqual(["table@5", "discharge@5"]);
  expect(await kinds(1274)).toEqual(["amend@1"]);
  expect(await kinds(873)).toEqual([]);
});

test("a House rule is listed for its riders, never flagged or x-rayed on its score", async () => {
  const { isSpecialRule } = await import("../src/rules.ts");
  const { withRiders, flaggedOf } = await import("../src/digest.ts");

  expect(isSpecialRule(ruleStatus())).toBe(true);
  expect(isSpecialRule({ id: "119-hres-189", title: "Censuring Representative Al Green of Texas." })).toBe(false);
  const c = defined(candidate(ruleStatus(), "2026-09-01"), "a candidate");
  c.score = 99;
  expect(flaggedOf([c])).toEqual([]);
  expect(toXray([c], 3)).toEqual([]);
  expect(withRiders([c])).toEqual([]);
  c.evidence.riders = [{ kind: "clock", label: "Stops the clock", section: "4", quote: "Each day …" }];
  expect(withRiders([c])).toEqual([c]);

  const r: WatchResult = {
    date: "2026-10-10",
    since: "2026-10-09",
    actionsSince: "2026-09-01",
    generatedAt: "2026-10-10T12:00:00.000Z",
    sources: [],
    candidates: [c],
    alreadyReported: 0,
    xrayed: [],
    site: { published: [], deploy: { status: "disabled", reason: "test" } },
    problems: [],
  };

  const d = digestJson(r);
  expect(d.movedBills).toEqual([]);
  expect(digestMarkdown(d)).toContain("## Riders in House rules");
  expect(digestMarkdown(d)).toContain('- **Stops the clock** (Sec. 4): "Each day …"');
});

test("late is measured from the last text before the floor, so a section added on the way to passage counts", async () => {
  expect(newSections(textShape(await textFixture("rh")), textShape(await textFixture("eh")))).toEqual([
    "3. Requiring voters to provide photo identification",
  ]);

  const s = {
    ...status(),
    versions: [version("eh", "2026-07-22"), version("rh", "2026-01-20"), version("ih", "2026-01-12")],
  };

  expect(beforeFloor(s)?.code).toBe("rh");
  expect(beforeFloor({ ...s, versions: [version("rh", "2026-01-20"), version("ih", "2026-01-12")] })).toBeNull();
});

test("a sweep reads the press for its best bills, every bill that reached the President and every contested vote", async () => {
  const { sweepShortlist } = await import("../src/sweep.ts");

  const law = scored("119-hr-4405", 15, "law");
  const fight = scored("119-hr-22", 40, "passed");
  const minor = scored("119-hr-9", 20, "passed", { yeas: 400, nays: 3 });
  const kids = scored("119-hr-7757", 11, "passed", { yeas: 267, nays: 117 });
  expect(sweepShortlist([minor, law, kids, fight], 1).map((c) => c.status.id)).toEqual([
    "119-hr-22",
    "119-hr-4405",
    "119-hr-7757",
  ]);
});
