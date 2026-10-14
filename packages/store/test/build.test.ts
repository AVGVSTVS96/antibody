import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Bundle, checkBundle, TABLES, type TableName } from "@antibody/core";
import { buildBundle } from "../src/build.ts";
import { type Db, loadTables, openDb } from "../src/db.ts";
import { GENIUS_ROWS } from "./genius-rows.ts";

const dir = await mkdtemp(join(tmpdir(), "antibody-build-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

async function load(rows: Record<string, Record<string, unknown>[]>): Promise<Db> {
  const out = await mkdtemp(join(dir, "out-"));
  for (const [table, rs] of Object.entries(rows)) {
    if (!(table in TABLES)) continue;
    for (const r of rs) TABLES[table as TableName].schema.parse(r);
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
const claim = (id: string) => b.claims[id]!;

describe("GENIUS bundle from contract rows", () => {
  test("is valid and every claim and endpoint resolves", () => {
    expect(checkBundle(b)).toEqual([]);
    expect(b.bill.law).toBe("P.L. 119-27");
    expect(b.bill.sponsor).toBe("member:H000601");
    expect(claim("bills/119-s-1582").text).toBe("S.1582, the GENIUS Act, became Public Law 119-27 on July 18, 2025.");
  });

  test("versions run in date order, the predecessor as a labeled inference", () => {
    expect(b.versions.map((v) => v.code)).toEqual(["s394-is", "pcs", "es", "enr"]);
    const pred = b.versions[0]!;
    expect(pred.predecessor).toBe(true);
    expect(claim(pred.claim).kind).toBe("inference");
    expect(claim(pred.claim).restsOn).toEqual(["versions/119-s-1582@s394-is"]);
  });

  test("the late section names where it first appears, and who inserted it is an inference", () => {
    const s19 = b.sections.find((s) => s.num === "19")!;
    expect(s19.late).toBe(true);
    expect(claim(s19.claims[0]!).text).toContain('first appears in the "Engrossed in Senate" text');
    const ins = edges("inserted")[0]!;
    expect(ins).toMatchObject({ src: "member:H000601", dst: `section:${s19.id}`, basis: "inference" });
  });

  test("only passage votes get per-member edges; every roll call is listed", () => {
    expect(b.votes.map((v) => v.number)).toEqual([310, 318]);
    expect(
      edges("voted")
        .map((e) => e.id)
        .sort(),
    ).toEqual(["voted:senate-119-1-318:G000555", "voted:senate-119-1-318:H000601", "voted:senate-119-1-318:W000817"]);
    expect(b.rules.map((r) => r.id)).toContain("member-votes");
  });

  test("a deficit figure rests on the lines it adds up", () => {
    const d = b.dollars.wholeBill.find((x) => x.measure === "deficit")!;
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
    const toSection = edges("lobbied").find((e) => e.dst.startsWith("section:"))!;
    expect(toSection.src).toBe("client:coinbase");
    expect(toSection.dst).toBe("section:119-s-1582@pcs:sec:4");
    expect(claim(`lda_bill_refs/9beeca5f-74bd-4012-8957-7053df57e67a#0#119-s-1582`).text).toBe(
      'PORTERFIELD, FETTIG & SEARS, LLC reported lobbying for COINBASE, INC. in Q1 2025 on S.1582 (GENIUS Act) (the filing says "S.1582").',
    );
  });

  test("lobbying dollars: the factual total on the edge, the bill-share estimate beside it as an inference", () => {
    const e = edges("lobbied").find((x) => x.id === "lobbied:coinbase")!;
    if (e.kind !== "lobbied") throw new Error("not lobbied");
    expect(e.basis).toBe("fact");
    expect(e.props).toMatchObject({ spendTotalUsd: 60000, shareEstimateUsd: 20000 });
    expect(e.claims).toContain("lda_spend/119-s-1582:coinbase#total");
    const share = claim(e.props.shareClaim!);
    expect(share).toMatchObject({ kind: "inference", restsOn: ["lda_spend/119-s-1582:coinbase#total"] });
    expect(claim("lda_spend/119-s-1582:coinbase#total").restsOn).toEqual([
      "lda_filings/9beeca5f-74bd-4012-8957-7053df57e67a",
    ]);
    expect(b.lobbying).toMatchObject({ spendTotalUsd: 1_580_000, shareEstimateUsd: 526_667 });
    expect(b.rules.find((r) => r.id === "lda-bill-share")!.text).toContain("issue lines");
  });

  test("lobbyists are drawn only with a covered position, quoted as filed", () => {
    const lobbyists = b.nodes.filter((n) => n.kind === "lobbyist");
    expect(lobbyists.map((n) => n.label)).toEqual(["Test Lobbyist"]);
    const [pos] = (lobbyists[0] as Extract<Bundle["nodes"][number], { kind: "lobbyist" }>).props.coveredPositions;
    expect(claim(pos!.claim).quote).toBe("Legislative Assistant, Sen. Test");
  });

  test("trades in tied stock: in the window only, owner always said", () => {
    const traded = edges("traded");
    expect(traded.map((e) => e.id).sort()).toEqual([
      "traded:B001236:70858",
      "traded:C001123:1679788",
      "traded:M001236:1679788",
      "traded:X000001:1679788",
    ]);
    const test = traded.find((e) => e.id === "traded:X000001:1679788")!;
    expect(test.kind === "traded" && test.props.events.map((e) => e.owner)).toEqual(["spouse"]);
    expect(claim("trades/20099999#1").text).toBe(
      "Rep. Test Representative (D-CA)'s spouse sold Coinbase Global, Inc. (COIN) worth $1,001 - $15,000 on August 1, 2025.",
    );
    expect(claim("trades/52c9fa8c#1").text).toStartWith("Sen. John Boozman (R-AR) and spouse, jointly, sold part of");
  });

  test("the same wording for both parties", () => {
    const strip = (id: string) => claim(id).text.replace(/(Rep|Sen)\. [^()]+\([RDI]-[A-Z]{2}\)/, "MEMBER");
    expect(strip("trades/20032256#1").replace("September 11", "D")).toBe(
      strip("trades/20033455#5").replace("October 9", "D"),
    );
    expect(strip("member_votes/senate-119-1-318:H000601")).toBe(strip("member_votes/senate-119-1-318:G000555"));
    expect(claim("members/H000601#2025-01-03").text).toBe(
      "Bill Hagerty served as a Republican senator from Tennessee from January 3, 2025 to January 3, 2031.",
    );
    expect(claim("members/G000555#2025-01-03").text).toBe(
      "Kirsten E. Gillibrand served as a Democratic senator from New York from January 3, 2025 to January 3, 2031.",
    );
  });

  test("PAC money from a PAC that resolves to a tied company, in the bill's cycles", () => {
    expect(
      edges("funded")
        .map((e) => e.dst)
        .sort(),
    ).toEqual(["member:G000555", "member:L000571"]);
    expect(
      edges("resolves_to")
        .map((e) => e.src)
        .sort(),
    ).toEqual(["client:bank", "client:coinbase", "pac:C00364778"]);
    expect(edges("resolves_to").every((e) => e.basis === "inference")).toBe(true);
  });

  test("a gift is split into before and after the member's vote", () => {
    for (const e of edges("funded")) {
      if (e.kind !== "funded") continue;
      expect(e.props.beforeUsd + e.props.afterUsd).toBe(e.props.amountUsd);
    }
    const g = edges("funded").find((e) => e.dst === "member:G000555")!;
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
    const gap = b.gaps.find((g) => g.kind === "paper_filings_unread")!;
    expect(gap.text).toContain("1 member (0 R, 1 D, 0 I)");
    expect(gap.nodes).toEqual(["member:X000001"]);
    const node = b.nodes.find((n) => n.id === "member:X000001")!;
    expect(node.kind === "member" && node.props.paperFilingsUnread).toBe(true);
  });

  test("published rules cover every inference rule used", () => {
    const ids = new Set(b.rules.map((r) => r.id));
    for (const c of Object.values(b.claims)) if (c.rule) expect(ids.has(c.rule.split(":")[0]!)).toBe(true);
    expect(b.rules.find((r) => r.id === "tied-stock")!.url).toContain("docs/rules.md#tied-stock");
  });

  test("nothing was silently dropped", () => {
    expect(warnings).toEqual([]);
  });
});

test("an even split of a CBO group line is an inference that keeps the sign, and the group's own total is not added on top", async () => {
  const bill = GENIUS_ROWS.bills!;
  const secs = GENIUS_ROWS.sections!;
  const est = { ...GENIUS_ROWS.cbo_estimates![0]!, per_section: true };
  const base = { ...GENIUS_ROWS.cbo_lines![0]!, measure: "outlays", split: "exact" };
  const group = {
    ...base,
    id: "s1582-es:group",
    line_kind: "group",
    section_nums: ["1", "4"],
    section_ids: [secs[0]!.id, secs[1]!.id],
    total_musd: -149,
  };
  const share = (i: number) => ({
    ...base,
    id: `s1582-es:s${i}`,
    line_kind: "section",
    section_nums: [String(i)],
    section_ids: [secs[i === 1 ? 0 : 1]!.id],
    total_musd: -74.5,
    split: "even_split",
    rests_on: ["cbo_lines/s1582-es:group"],
  });
  const { bundle } = await buildBundle(
    await load({ bills: bill, sections: secs, cbo_estimates: [est], cbo_lines: [group, share(1), share(4)] }),
    "119-s-1582",
    { now: NOW },
  );
  const dollars = bundle.sections.find((s) => s.num === "4")!.dollars;
  expect(dollars).toHaveLength(1);
  const d = dollars[0]!;
  expect(d).toMatchObject({ amountMusd: -74.5, split: "even_split" });
  const c = bundle.claims[d.claim]!;
  expect(c.kind).toBe("inference");
  expect(c.restsOn).toEqual(["cbo_lines/s1582-es:s4"]);
  expect(bundle.claims["cbo_lines/s1582-es:s4"]!.restsOn).toEqual(["cbo_lines/s1582-es:group"]);
  expect(c.text).toContain("decreases outlays by $74.5 million");
  expect(checkBundle(bundle)).toEqual([]);
});

test("a bundle rebuilds byte for byte, however the rows were loaded", async () => {
  const reversed = Object.fromEntries(Object.entries(GENIUS_ROWS).map(([t, rs]) => [t, [...rs!].reverse()]));
  const again = await buildBundle(await load(reversed), "119-s-1582", { now: NOW });
  expect(JSON.stringify(again.bundle)).toBe(JSON.stringify(b));
});

test("a member shows the party and chamber of the term that covers the bill", async () => {
  const rows = structuredClone(GENIUS_ROWS);
  const hagerty = rows.members!.find((m) => m.id === "H000601")!;
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
  const node = bundle.nodes.find((n) => n.id === "member:H000601")!;
  expect(node.kind === "member" && [node.label, node.props.party, node.props.chamber]).toEqual([
    "Sen. Bill Hagerty (R-TN)",
    "R",
    "Senate",
  ]);
  expect(node.claims).toEqual(["members/H000601#2021-01-03"]);
});

test("a bill with no rows says so", async () => {
  await expect(buildBundle(await load({}), "119-s-1582")).rejects.toThrow(/no bills row/);
});

test("a differing asset name is marked, not hidden", async () => {
  const rows = structuredClone(GENIUS_ROWS);
  const moore = rows.trades!.find((t) => t.id === "20032256#1")!;
  moore.asset = "Banana Holdings Common Stock (COIN) [ST]";
  const { bundle } = await buildBundle(await load(rows), "119-s-1582", { now: NOW });
  const events = bundle.edges.flatMap((e) => (e.kind === "traded" ? e.props.events : []));
  expect(events.find((t) => t.asset.startsWith("Banana"))!.nameMatch).toBe(false);
  expect(events.find((t) => t.asset.startsWith("Coinbase"))!.nameMatch).toBe(true);
});

test("a bill listed only by a description takes the name its first section gives it", async () => {
  const rows = structuredClone(GENIUS_ROWS);
  rows.bills![0]!.short_title = "An act to provide for reconciliation pursuant to title II of H. Con. Res. 14.";
  const first = rows.sections!.find((s) => s.num === "1")!;
  first.heading = "Short title";
  first.preview = "This Act may be cited as the One Big Beautiful Bill Act .";
  const { bundle } = await buildBundle(await load(rows), "119-s-1582", { now: NOW });
  expect(bundle.bill.shortTitle).toBe("One Big Beautiful Bill Act");
});

test("a lobbying total cites the first filing it adds and lists every one under rests on, never a search that cannot reproduce the number", () => {
  const total = b.claims["lda_spend/119-s-1582:coinbase#total"]!;
  expect(total.sourceUrl).not.toContain("/api/v1/filings/?");
  expect(total.restsOn.length).toBeGreaterThan(0);
  expect(total.restsOn.every((id) => id.startsWith("lda_filings/"))).toBe(true);
  expect(total.sourceLocator).toContain("rests on");
});
