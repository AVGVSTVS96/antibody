import { expect, test } from "bun:test";
import { Bundle } from "@antibody/core";
import type { EdgeOf, NodeOf } from "@antibody/core";
import fixture from "../../core/fixtures/genius-mini.bundle.json";
import { limitGraph } from "../src/limit.ts";

const client = (key: string): NodeOf<"client"> => ({
  id: `client:${key}`,
  kind: "client",
  label: key,
  claims: [],
  props: { names: [key], ldaClientIds: [], description: null },
});

const lobbied = (key: string, reports: number, topicOnly = false): EdgeOf<"lobbied"> => ({
  id: topicOnly ? `lobbied:topic:${key}` : `lobbied:${key}`,
  kind: "lobbied",
  src: `client:${key}`,
  dst: "bill:119-s-1",
  basis: "fact",
  claims: [],
  props: {
    reports,
    quarters: 1,
    phases: { bill: reports, enactmentQuarter: 0, law: 0 },
    spendTotalUsd: null,
    shareEstimateUsd: null,
    issueQuote: null,
    topicOnly,
  },
});

const funded = (pac: string, member: string, amountUsd: number): EdgeOf<"funded"> => ({
  id: `funded:${pac}:${member}`,
  kind: "funded",
  src: `pac:${pac}`,
  dst: `member:${member}`,
  basis: "fact",
  claims: [],
  props: {
    cutoff: "2025-06-17",
    cutoffKind: "vote",
    beforeUsd: amountUsd,
    afterUsd: 0,
    amountUsd,
    contributions: 1,
    first: "2025-06-01",
    last: "2025-06-01",
    allTxnsUrl: `https://www.fec.gov/data/receipts/?committee_id=${pac}`,
  },
});

const hire = (
  id: string,
  kind: "hired" | "employs",
  src: EdgeOf<"hired">["src"],
  dst: EdgeOf<"hired">["dst"],
): EdgeOf<"hired"> | EdgeOf<"employs"> => ({ id, kind, src, dst, basis: "fact", claims: [], props: { reports: 1 } });

function bundle(): Bundle {
  return {
    ...Bundle.parse(fixture),
    nodes: [
      ...["a", "b", "c", "d"].map(client),
      { id: "registrant:1", kind: "registrant", label: "1", claims: [], props: { ldaId: "1" } },
      { id: "registrant:2", kind: "registrant", label: "2", claims: [], props: { ldaId: "2" } },
      { id: "lobbyist:1", kind: "lobbyist", label: "1", claims: [], props: { ldaId: "1", coveredPositions: [] } },
      { id: "lobbyist:2", kind: "lobbyist", label: "2", claims: [], props: { ldaId: "2", coveredPositions: [] } },
      {
        id: "company:9",
        kind: "company",
        label: "9",
        claims: [],
        props: { cik: "9", tickers: [], secUrl: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=9" },
      },
      {
        id: "member:M1",
        kind: "member",
        label: "M1",
        claims: [],
        props: { bioguide: "M1", party: "D", state: "CA", district: 1, chamber: "House", paperFilingsUnread: false },
      },
      ...["p1", "p2", "p3"].map((p): NodeOf<"pac"> => ({
        id: `pac:${p}`,
        kind: "pac",
        label: p,
        claims: [],
        props: { fecId: p, connectedOrg: null, subsidiaryOf: null },
      })),
    ],
    edges: [
      lobbied("a", 9),
      lobbied("b", 5),
      lobbied("c", 1),
      lobbied("d", 1),
      {
        id: "res:d",
        kind: "resolves_to",
        src: "client:d",
        dst: "company:9",
        basis: "inference",
        claims: [],
        props: { method: "name", reason: null },
      },
      hire("hired:a:1", "hired", "client:a", "registrant:1"),
      hire("hired:c:2", "hired", "client:c", "registrant:2"),
      hire("employs:1:1", "employs", "registrant:1", "lobbyist:1"),
      hire("employs:2:2", "employs", "registrant:2", "lobbyist:2"),
      funded("p1", "M1", 300),
      funded("p2", "M1", 200),
      funded("p3", "M1", 100),
    ],
    gaps: [],
  };
}

test("keeps the clients with the most reports and every client that resolves to a company", () => {
  const b = limitGraph(bundle(), { clients: 2, fundersPerMember: 5 });
  const ids = b.nodes.map((n) => n.id);
  expect(ids).toContain("client:a");
  expect(ids).toContain("client:b");
  expect(ids).toContain("client:d");
  expect(ids).not.toContain("client:c");
  expect(b.gaps.map((g) => g.id)).toEqual(["clients-limited"]);
  expect(b.gaps[0]?.text).toContain("3 of 4");
});

test("the gap tells clients that named the bill from ones that only describe its subject", () => {
  const b = bundle();
  b.nodes.push(client("t"));
  b.edges.push(lobbied("t", 0, true));
  expect(limitGraph(b, { clients: 2, fundersPerMember: 5 }).gaps[0]?.text).toContain(
    "(4 named this bill, 1 only describes its subject)",
  );
});

test("a registrant or lobbyist leaves with its last drawn client", () => {
  const b = limitGraph(bundle(), { clients: 2, fundersPerMember: 5 });
  const ids = b.nodes.map((n) => n.id);
  expect(ids).toContain("registrant:1");
  expect(ids).toContain("lobbyist:1");
  expect(ids).not.toContain("registrant:2");
  expect(ids).not.toContain("lobbyist:2");
  expect(b.edges.some((e) => e.id === "employs:2:2")).toBe(false);
});

test("each member keeps their largest donors, whatever the party", () => {
  const b = limitGraph(bundle(), { clients: 10, fundersPerMember: 2 });
  expect(b.edges.filter((e) => e.kind === "funded").map((e) => e.src)).toEqual(["pac:p1", "pac:p2"]);
  expect(b.nodes.map((n) => n.id)).not.toContain("pac:p3");
  expect(b.gaps.map((g) => g.id)).toEqual(["funders-limited"]);
});

test("a bundle within the limits is untouched", () => {
  const b = limitGraph(bundle(), { clients: 10, fundersPerMember: 10 });
  expect(b.gaps).toEqual([]);
  expect(b.nodes.length).toBe(bundle().nodes.length);
});
