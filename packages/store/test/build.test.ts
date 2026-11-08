import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBundle, TABLE_NAMES, TABLES, must } from "@antibody/core";
import type { Bundle, Row } from "@antibody/core";
import { buildBundle } from "../src/build.ts";
import { loadTables, openDb } from "../src/db.ts";
import type { Db } from "../src/db.ts";
import { GENIUS_ROWS, geniusRows } from "./genius-rows.ts";
import type { Fixture } from "./genius-rows.ts";

const dir = await mkdtemp(join(tmpdir(), "antibody-build-"));

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function load(rows: Fixture): Promise<Db> {
  const out = await mkdtemp(join(dir, "out-"));

  for (const table of TABLE_NAMES) {
    const rs: object[] | undefined = rows[table];

    if (rs === undefined) {
      continue;
    }

    for (const r of rs) {
      TABLES[table].schema.parse(r);
    }

    await mkdir(join(out, table), { recursive: true });
    await Bun.write(join(out, table, "fixture.jsonl"), rs.map((r) => JSON.stringify(r)).join("\n"));
  }

  const db = await openDb(":memory:");
  await loadTables(db, (t) => join(out, t));

  return db;
}

const NOW = new Date("2026-10-13T12:00:00Z");
let b: Bundle;
let warnings: string[];

beforeAll(async () => {
  ({ bundle: b, warnings } = await buildBundle(await load(GENIUS_ROWS), "119-s-1582", { now: NOW }));
});

const edges = (kind: string) => b.edges.filter((e) => e.kind === kind);
const claim = (id: string) => must(b.claims[id], `claim ${id}`);

describe("GENIUS bundle from contract rows", () => {
  test("is valid and every claim and endpoint resolves", () => {
    expect(checkBundle(b)).toEqual([]);
    expect(b.bill.law).toBe("P.L. 119-27");
    expect(b.bill.sponsor).toBe("member:H000601");
    expect(claim("bills/119-s-1582").text).toBe("S.1582, the GENIUS Act, became Public Law 119-27 on July 18, 2025.");
  });

  test("versions run in date order, the predecessor as a labeled inference", () => {
    expect(b.versions.map((v) => v.code)).toEqual(["s394-is", "pcs", "es", "enr"]);
    const pred = must(b.versions[0], "first version");
    expect(pred.predecessor).toBe(true);
    expect(claim(pred.claim).kind).toBe("inference");
    expect(claim(pred.claim).restsOn).toEqual(["versions/119-s-1582@s394-is"]);
  });

  test("the late section names where it first appears, and who inserted it is an inference", () => {
    const s19 = must(
      b.sections.find((s) => s.num === "19"),
      "section 19",
    );

    expect(s19.late).toBe(true);
    expect(claim(must(s19.claims[0], "section 19 claim")).text).toContain(
      'first appears in the "Engrossed in Senate" text',
    );
    const ins = must(edges("inserted")[0], "inserted edge");
    expect(ins).toMatchObject({ src: "member:H000601", dst: `section:${s19.id}`, basis: "inference" });
  });

  test("only passage votes get per-member edges; every roll call is listed", () => {
    expect(b.votes.map((v) => v.number)).toEqual([310, 318]);
    expect(
      edges("voted")
        .map((e) => e.id)
        .toSorted(),
    ).toEqual(["voted:senate-119-1-318:G000555", "voted:senate-119-1-318:H000601", "voted:senate-119-1-318:W000817"]);
    expect(b.rules.map((r) => r.id)).toContain("member-votes");
  });

  test("a deficit figure rests on the lines it adds up", () => {
    const d = must(
      b.dollars.wholeBill.find((x) => x.measure === "deficit"),
      "deficit",
    );

    expect(d.amountMusd).toBe(120);
    expect(claim(d.claim).restsOn).toEqual(["cbo_lines/s1582-es:outlays", "cbo_lines/s1582-es:revenues"]);
    expect(claim(d.claim).text).toBe(
      "CBO: the bill adds $120 million to deficits over 2025-2035 (current-law baseline).",
    );
    expect(claim("cbo_lines/s1582-es:revenues").text).toContain("lowers revenues by $61 million");
    expect(b.gaps.map((g) => g.kind)).toContain("no_section_dollars");
  });

  test("lobbying: clients, registrants, the bill and the section they named", () => {
    expect(b.lobbying).toMatchObject({
      reports: 2,
      clients: 2,
      registrants: 2,
      lobbyists: 2,
      byPhase: { bill: 1, law: 1 },
    });

    const toSection = must(
      edges("lobbied").find((e) => e.dst.startsWith("section:")),
      "lobbied edge to a section",
    );

    expect(toSection.src).toBe("client:coinbase");
    expect(toSection.dst).toBe("section:119-s-1582@pcs:sec:4");
    expect(claim(`lda_bill_refs/9beeca5f-74bd-4012-8957-7053df57e67a#0#119-s-1582`).text).toBe(
      'PORTERFIELD, FETTIG & SEARS, LLC reported lobbying for COINBASE, INC. in Q1 2025 on S.1582 (GENIUS Act) (the filing says "S.1582").',
    );
  });

  test("lobbying dollars: the filing total only, never a per-bill share", () => {
    const e = edges("lobbied").find((x) => x.id === "lobbied:coinbase");

    if (e?.kind !== "lobbied") {
      throw new Error("not lobbied");
    }

    expect(e.basis).toBe("fact");
    expect(e.props).toMatchObject({ spendTotalUsd: 60_000, shareEstimateUsd: null, shareClaim: null });
    expect(e.claims).toContain("lda_spend/119-s-1582:coinbase#total");
    expect(claim("lda_spend/119-s-1582:coinbase#total").text).toContain("not what was spent on this bill");
    expect(claim("lda_spend/119-s-1582:coinbase#total").restsOn).toEqual([
      "lda_filings/9beeca5f-74bd-4012-8957-7053df57e67a",
    ]);
    expect(b.lobbying).toMatchObject({ spendTotalUsd: 1_580_000, shareEstimateUsd: null });
    expect(b.rules.some((r) => r.id === "lda-bill-share")).toBe(false);
  });

  test("lobbyists are drawn only with a covered position, quoted as filed", () => {
    const lobbyists = b.nodes.filter((n) => n.kind === "lobbyist");
    expect(lobbyists.map((n) => n.label)).toEqual(["Test Lobbyist"]);
    const pos = lobbyists[0]?.props.coveredPositions[0];
    expect(claim(must(pos, "covered position").claim).quote).toBe("Legislative Assistant, Sen. Test");
  });

  test("trades in tied stock: in the window only, owner always said", () => {
    const traded = edges("traded");
    expect(traded.map((e) => e.id).toSorted()).toEqual([
      "traded:B001236:70858",
      "traded:C001123:1679788",
      "traded:M001236:1679788",
      "traded:X000001:1679788",
    ]);

    const spouseTrade = must(
      traded.find((e) => e.id === "traded:X000001:1679788"),
      "spouse trade",
    );

    expect(spouseTrade.kind === "traded" && spouseTrade.props.events.map((e) => e.owner)).toEqual(["spouse"]);
    expect(claim("trades/20099999#1").text).toBe(
      "Rep. Test Representative (D-CA)'s spouse sold Coinbase Global, Inc. (COIN) worth $1,001 - $15,000 on August 1, 2025.",
    );
    expect(claim("trades/52c9fa8c#1").text).toStartWith("Sen. John Boozman (R-AR) and spouse, jointly, sold part of");
  });

  test("the same wording for both parties", () => {
    const strip = (id: string) => claim(id).text.replace(/(Rep|Sen)\. [^()]+\([RDI]-[A-Z]{2}\)/u, "MEMBER");
    expect(strip("trades/20032256#1").replace("September 11", "D")).toBe(
      strip("trades/20033455#5").replace("October 9", "D"),
    );
    expect(strip("member_votes/senate-119-1-318:H000601")).toBe(strip("member_votes/senate-119-1-318:G000555"));
    expect(claim("members/H000601#2025-01-03").text).toBe(
      "Bill Hagerty serves as a Republican senator from Tennessee from January 3, 2025; the term ends January 3, 2031.",
    );
    expect(claim("members/G000555#2025-01-03").text).toBe(
      "Kirsten E. Gillibrand serves as a Democratic senator from New York from January 3, 2025; the term ends January 3, 2031.",
    );
  });

  test("PAC money from a PAC that resolves to a tied company, in the bill's cycles", () => {
    expect(
      edges("funded")
        .map((e) => e.dst)
        .toSorted(),
    ).toEqual(["member:G000555", "member:L000571"]);
    expect(
      edges("resolves_to")
        .map((e) => e.src)
        .toSorted(),
    ).toEqual(["client:bank", "client:coinbase", "pac:C00364778"]);
    expect(edges("resolves_to").every((e) => e.basis === "inference")).toBe(true);
  });

  test("a gift is split into before and after the member's vote", () => {
    for (const e of edges("funded")) {
      if (e.kind !== "funded") {
        continue;
      }

      expect(e.props.beforeUsd + e.props.afterUsd).toBe(e.props.amountUsd);
    }

    const g = must(
      edges("funded").find((e) => e.dst === "member:G000555"),
      "Gillibrand funding",
    );

    expect(g.kind === "funded" && g.props).toMatchObject({
      cutoff: "2025-06-17",
      cutoffKind: "vote",
      beforeUsd: 1000,
      afterUsd: 0,
    });
  });

  test("a trade joins its company by ticker, and says when the asset name differs", () => {
    const events = edges("traded").flatMap((e) => (e.kind === "traded" ? e.props.events : []));
    expect(events.every((t) => t.nameMatch === true)).toBe(true);
  });

  test("unread paper filings become a gap that counts every party", () => {
    const gap = must(
      b.gaps.find((g) => g.kind === "paper_filings_unread"),
      "paper filings gap",
    );

    expect(gap.text).toContain("1 member (0 R, 1 D, 0 I)");
    expect(gap.nodes).toEqual(["member:X000001"]);

    const node = must(
      b.nodes.find((n) => n.id === "member:X000001"),
      "member X000001",
    );

    expect(node.kind === "member" && node.props.paperFilingsUnread).toBe(true);
  });

  test("the bundle counts every member with unread paper filings, drawn in the graph or not", () => {
    expect(b.paperUnread).toEqual({ R: 0, D: 1, I: 0 });
  });

  test("published rules cover every inference rule used", () => {
    const ids = new Set(b.rules.map((r) => r.id));

    for (const c of Object.values(b.claims)) {
      if (c.rule !== null && c.rule !== "") {
        expect(ids.has(c.rule.replace(/:.*/su, ""))).toBe(true);
      }
    }

    expect(
      must(
        b.rules.find((r) => r.id === "tied-stock"),
        "tied-stock rule",
      ).url,
    ).toContain("docs/rules.md#tied-stock");
  });

  test("nothing was silently dropped", () => {
    expect(warnings).toEqual([]);
  });
});

test("an even split of a CBO group line is an inference that keeps the sign, and the group's own total is not added on top", async () => {
  const bill = GENIUS_ROWS.bills;
  const [first, fourth] = GENIUS_ROWS.sections;
  const est = { ...must(GENIUS_ROWS.cbo_estimates[0], "CBO estimate"), per_section: true };
  const base: Row<"cbo_lines"> = { ...must(GENIUS_ROWS.cbo_lines[0], "CBO line"), measure: "outlays", split: "exact" };

  const group: Row<"cbo_lines"> = {
    ...base,
    id: "s1582-es:group",
    line_kind: "group",
    section_nums: ["1", "4"],
    section_ids: [must(first, "section 1").id, must(fourth, "section 4").id],
    total_musd: -149,
  };

  const share = (i: number): Row<"cbo_lines"> => ({
    ...base,
    id: `s1582-es:s${i}`,
    line_kind: "section",
    section_nums: [String(i)],
    section_ids: [must(i === 1 ? first : fourth, `section ${i}`).id],
    total_musd: -74.5,
    split: "even_split",
    rests_on: ["cbo_lines/s1582-es:group"],
  });

  const { bundle } = await buildBundle(
    await load({
      bills: bill,
      sections: GENIUS_ROWS.sections,
      cbo_estimates: [est],
      cbo_lines: [group, share(1), share(4)],
    }),
    "119-s-1582",
    { now: NOW },
  );

  const dollars = must(
    bundle.sections.find((s) => s.num === "4"),
    "section 4",
  ).dollars;

  expect(dollars).toHaveLength(1);
  const d = must(dollars[0], "section 4 dollars");
  expect(d).toMatchObject({ amountMusd: -74.5, split: "even_split" });
  const c = must(bundle.claims[d.claim], "split claim");
  expect(c.kind).toBe("inference");
  expect(c.restsOn).toEqual(["cbo_lines/s1582-es:s4"]);
  expect(bundle.claims["cbo_lines/s1582-es:s4"]?.restsOn).toEqual(["cbo_lines/s1582-es:group"]);
  expect(c.text).toContain("decreases outlays by $74.5 million");
  expect(checkBundle(bundle)).toEqual([]);
});

test("a CBO row tied to a section by its heading is an inference that rests on the section; a numbered row stays a fact", async () => {
  const bill = GENIUS_ROWS.bills;
  const secs = GENIUS_ROWS.sections;
  const est = { ...must(GENIUS_ROWS.cbo_estimates[0], "CBO estimate"), per_section: true };
  const sec = (i: number) => must(secs[i], `section at ${i}`);

  const row = (id: string, i: number, joinedBy: "number" | "heading"): Row<"cbo_lines"> => ({
    ...must(GENIUS_ROWS.cbo_lines[0], "CBO line"),
    id,
    line_kind: "section",
    section_nums: [sec(i).num],
    section_ids: [sec(i).id],
    measure: "outlays",
    total_musd: -50_807,
    split: "exact",
    join: joinedBy,
    rests_on: [],
  });

  const { bundle } = await buildBundle(
    await load({
      bills: bill,
      sections: secs,
      cbo_estimates: [est],
      cbo_lines: [row("s1582-es:h", 0, "heading"), row("s1582-es:n", 1, "number")],
    }),
    "119-s-1582",
    { now: NOW },
  );

  const claimOf = (i: number) => {
    const dollars = bundle.sections.find((x) => x.num === sec(i).num)?.dollars[0];

    return must(bundle.claims[must(dollars, `dollars of section at ${i}`).claim], `claim of section at ${i}`);
  };

  const byHeading = claimOf(0);
  expect(byHeading.kind).toBe("inference");
  expect(byHeading.rule).toContain("cbo-heading-join");
  expect(byHeading.restsOn).toEqual([`sections/${sec(0).id}`]);
  expect(byHeading.text).toContain("CBO printed no section number");
  const byNumber = claimOf(1);
  expect(byNumber.kind).toBe("fact");
  expect(checkBundle(bundle)).toEqual([]);
});

test("a bundle rebuilds byte for byte, however the rows were loaded", async () => {
  const reversed = Object.fromEntries(Object.entries(GENIUS_ROWS).map(([t, rs]) => [t, rs.toReversed()]));
  const again = await buildBundle(await load(reversed), "119-s-1582", { now: NOW });
  expect(JSON.stringify(again.bundle)).toBe(JSON.stringify(b));
});

test("a member shows the party and chamber of the term that covers the bill", async () => {
  const rows = geniusRows();

  const hagerty = must(
    rows.members.find((m) => m.id === "H000601"),
    "Hagerty",
  );

  hagerty.terms = [
    {
      chamber: "House",
      start: "2019-01-03",
      end: "2021-01-03",
      state: "TN",
      district: 7,
      party: "Democrat",
      caucus: null,
    },
    {
      chamber: "Senate",
      start: "2021-01-03",
      end: "2027-01-03",
      state: "TN",
      district: null,
      party: "Republican",
      caucus: null,
    },
  ];
  hagerty.party = "D";
  const { bundle } = await buildBundle(await load(rows), "119-s-1582", { now: NOW });

  const node = must(
    bundle.nodes.find((n) => n.id === "member:H000601"),
    "Hagerty node",
  );

  expect(node.kind === "member" && [node.label, node.props.party, node.props.chamber]).toEqual([
    "Sen. Bill Hagerty (R-TN)",
    "R",
    "Senate",
  ]);
  expect(node.claims).toEqual(["members/H000601#2021-01-03"]);
});

test("a bill with no rows says so", async () => {
  const db = await load({});
  const failure = await buildBundle(db, "119-s-1582").catch(String);
  expect(failure).toMatch(/no bills row/u);
});

test("a differing asset name is marked, not hidden", async () => {
  const rows = geniusRows();

  const moore = must(
    rows.trades.find((t) => t.id === "20032256#1"),
    "Moore trade",
  );

  moore.asset = "Banana Holdings Common Stock (COIN) [ST]";
  const { bundle } = await buildBundle(await load(rows), "119-s-1582", { now: NOW });
  const events = bundle.edges.flatMap((e) => (e.kind === "traded" ? e.props.events : []));
  expect(events.find((t) => t.asset.startsWith("Banana"))?.nameMatch).toBe(false);
  expect(events.find((t) => t.asset.startsWith("Coinbase"))?.nameMatch).toBe(true);
});

test("a bill listed only by a description takes the name its first section gives it", async () => {
  const rows = geniusRows();
  must(rows.bills[0], "bill").short_title =
    "An act to provide for reconciliation pursuant to title II of H. Con. Res. 14.";

  const first = must(
    rows.sections.find((s) => s.num === "1"),
    "section 1",
  );

  first.heading = "Short title";
  first.preview = "This Act may be cited as the One Big Beautiful Bill Act .";
  const { bundle } = await buildBundle(await load(rows), "119-s-1582", { now: NOW, names: {} });
  expect(bundle.bill.shortTitle).toBe("One Big Beautiful Bill Act");
});

test("a division's short title is not the bill's (H.R.815's FEND Off Fentanyl Act)", async () => {
  const rows = geniusRows();
  must(rows.bills[0], "bill").short_title = null;

  const first = must(
    rows.sections.find((s) => s.num === "1"),
    "section 1",
  );

  first.heading = "Short title";
  first.path = "division:E/sec:3001";
  first.preview = 'This division may be cited as the "FEND Off Fentanyl Act".';
  const { bundle } = await buildBundle(await load(rows), "119-s-1582", { now: NOW, names: {} });
  expect(bundle.bill.shortTitle).toBeNull();
});

test("a lobbying total cites the first filing it adds and lists every one under rests on, never a search that cannot reproduce the number", () => {
  const total = claim("lda_spend/119-s-1582:coinbase#total");
  expect(total.sourceUrl).not.toContain("/api/v1/filings/?");
  expect(total.restsOn.length).toBeGreaterThan(0);
  expect(total.restsOn.every((id) => id.startsWith("lda_filings/"))).toBe(true);
  expect(total.sourceLocator).toContain("rests on");
});

test("a long section's notable parts ride in its bundle entry, each with its own claims; ordinary parts stay out", async () => {
  const rows = geniusRows();

  const sec4 = must(
    rows.sections.find((s) => s.num === "4"),
    "section 4",
  );

  const url = "https://www.govinfo.gov/content/pkg/BILLS-119s1582enr/xml/BILLS-119s1582enr.xml";

  const part = (en: string, ord: number, heading: string, first: string, late: boolean): Row<"section_parts"> => ({
    id: `${sec4.id}${en}`,
    bill_id: "119-s-1582",
    section_id: sec4.id,
    num: `4${en}`,
    ord,
    enum: en,
    heading,
    trail: ["Standards for the issuance of payment stablecoins"],
    path: `subsection:a/paragraph:${en.replace(/^.*\((\d+)\)$/u, "$1")}`,
    lead_in: false,
    words: 600,
    preview: "A public company that is not predominantly engaged in one or more financial activities",
    first_version: first,
    late,
    version: "enr",
    source_url: url,
    source_locator: "sec. 4, subsection (a), paragraph (12)",
  });

  rows.section_parts = [
    part("(a)(1)", 0, "In general", "pcs", false),
    part("(a)(12)", 11, "Non-financial services public companies", "es", true),
  ];

  const score = (partId: string | null, late: boolean): Row<"section_scores"> => ({
    id: `119-s-1582:${partId ?? sec4.id}`,
    bill_id: "119-s-1582",
    section_id: sec4.id,
    part_id: partId,
    label: "normal",
    buried: null,
    dollars_musd: null,
    dollars_split: null,
    attention_pct: null,
    attention_share: null,
    attention_checked: null,
    late,
    late_cleared_by: null,
    off_topic: null,
    lobbying_reports: 0,
    lobbying_firms: 0,
    offsets_section_id: null,
    reach: [],
    rule: "buried-v5: test",
    confidence: 0.7,
    rests_on: [`sections/${sec4.id}`, ...(partId !== null && partId !== "" ? [`section_parts/${partId}`] : [])],
    evidence: {},
  });

  rows.section_scores = [score(null, false), score(`${sec4.id}(a)(1)`, false), score(`${sec4.id}(a)(12)`, true)];
  const { bundle } = await buildBundle(await load(rows), "119-s-1582", { now: NOW });
  expect(checkBundle(bundle)).toEqual([]);

  const s4 = must(
    bundle.sections.find((s) => s.num === "4"),
    "section 4",
  );

  expect(s4.parts.map((p) => [p.num, p.heading, p.late, p.score?.components.late])).toEqual([
    ["4(a)(12)", "Non-financial services public companies", true, true],
  ]);
  const p = must(s4.parts[0], "part");
  expect(bundle.claims[must(p.claims[0], "part claim")]?.text).toBe(
    'Section 4(a)(12) ("Non-financial services public companies") is 600 words of section 4 ("Requirements for issuing payment stablecoins") in the "Enrolled Bill" text. It first appears in the "Engrossed in Senate" text (the earliest with at least half its wording), after a chamber had passed the bill, so it was added late.',
  );
  expect(bundle.claims[must(p.score, "part score").claim]?.text).toStartWith(
    'Section 4(a)(12) ("Non-financial services public companies"), a part of section 4 ("Requirements for issuing payment stablecoins") scored on its own (parts-v1), is scored normal',
  );
  expect(s4.score?.claim).toBe(`section_scores/119-s-1582:${sec4.id}`);
  expect(bundle.rules.find((r) => r.id === "parts-v1")?.url).toContain("docs/rules.md#parts-v1");
});

test("the parts rule the page publishes states the thresholds the splitter uses", async () => {
  const { PARTS } = await import("@antibody/ingest-bills");
  const { RULES } = await import("../src/rules.ts");
  const text = RULES["parts-v1"].text;
  expect(text).toContain(`longer than ${PARTS.splitOver} words`);
  expect(text).toContain(`longer than ${PARTS.pieceOver.toLocaleString("en-US")} words`);
  expect(text).toContain(`at least half its wording`);
  expect(PARTS.carried).toBe(0.5);
});
