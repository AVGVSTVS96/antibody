import { expect, test } from "bun:test";
import type { Bundle } from "@antibody/core";
import { limitGraph } from "../src/limit.ts";

const client = (key: string) => ({ id: `client:${key}`, kind: "client" });
const lobbied = (key: string, reports: number) => ({
  id: `lobbied:${key}`,
  kind: "lobbied",
  src: `client:${key}`,
  dst: "bill:119-s-1",
  props: { reports, topicOnly: false },
});
const funded = (pac: string, member: string, amountUsd: number) => ({
  id: `funded:${pac}:${member}`,
  kind: "funded",
  src: `pac:${pac}`,
  dst: `member:${member}`,
  props: { amountUsd },
});

function bundle(): Bundle {
  return {
    nodes: [
      ...["a", "b", "c", "d"].map(client),
      { id: "registrant:1", kind: "registrant" },
      { id: "registrant:2", kind: "registrant" },
      { id: "lobbyist:1", kind: "lobbyist" },
      { id: "lobbyist:2", kind: "lobbyist" },
      { id: "company:9", kind: "company" },
      { id: "member:M1", kind: "member" },
      ...["p1", "p2", "p3"].map((p) => ({ id: `pac:${p}`, kind: "pac" })),
    ],
    edges: [
      lobbied("a", 9),
      lobbied("b", 5),
      lobbied("c", 1),
      lobbied("d", 1),
      { id: "res:d", kind: "resolves_to", src: "client:d", dst: "company:9", props: {} },
      { id: "hired:a:1", kind: "hired", src: "client:a", dst: "registrant:1", props: {} },
      { id: "hired:c:2", kind: "hired", src: "client:c", dst: "registrant:2", props: {} },
      { id: "employs:1:1", kind: "employs", src: "registrant:1", dst: "lobbyist:1", props: {} },
      { id: "employs:2:2", kind: "employs", src: "registrant:2", dst: "lobbyist:2", props: {} },
      funded("p1", "M1", 300),
      funded("p2", "M1", 200),
      funded("p3", "M1", 100),
    ],
    gaps: [],
  } as unknown as Bundle;
}

test("keeps the clients with the most reports and every client that resolves to a company", () => {
  const b = limitGraph(bundle(), { clients: 2, fundersPerMember: 5 });
  const ids = b.nodes.map((n) => n.id);
  expect(ids).toContain("client:a");
  expect(ids).toContain("client:b");
  expect(ids).toContain("client:d");
  expect(ids).not.toContain("client:c");
  expect(b.gaps.map((g) => g.id)).toEqual(["clients-limited"]);
  expect(b.gaps[0]!.text).toContain("3 of 4");
});

test("the gap tells clients that named the bill from ones that only describe its subject", () => {
  const b = bundle();
  b.nodes.push(client("t") as never);
  b.edges.push({
    id: "lobbied:topic:t",
    kind: "lobbied",
    src: "client:t",
    dst: "bill:119-s-1",
    props: { reports: 0, topicOnly: true },
  } as never);
  expect(limitGraph(b, { clients: 2, fundersPerMember: 5 }).gaps[0]!.text).toContain(
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
