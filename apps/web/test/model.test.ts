import { expect, test } from "bun:test";
import { Bundle, checkBundle } from "@antibody/core";
import genius from "../fixtures/119-s-1582.bundle.json";
import { buildModel, memberShort, shortName } from "../src/lib/model.ts";

const b = Bundle.parse(genius);

test("the GENIUS fixture is a valid, sound bundle", () => {
  expect(checkBundle(b)).toEqual([]);
});

test("clients and PACs merge into the company they resolve to", () => {
  const m = buildModel(b);
  const visa = m.actorById.get("company:1403161")!;
  expect(visa.ticker).toBe("V");
  expect(visa.clients.length).toBeGreaterThan(0);
  expect(visa.lobbied.length).toBe(1);
  expect(m.actors.filter((a) => a.lobbied.length).length).toBe(53);
});

test("a lobbied edge drawn from a company through an inferred resolution is an inference", () => {
  const m = buildModel(b);
  const e = m.edges.find((e) => e.kind === "lobbied" && e.src === "company:1403161")!;
  expect(e.inference).toBe(true);
  expect(e.claims.some((c) => c.startsWith("resolutions/"))).toBe(true);
});

test("sections carry their stage and score label", () => {
  const m = buildModel(b);
  expect(m.buried.map((v) => v.s.num)).toEqual(["19"]);
  expect(m.headline.length).toBe(3);
  expect(m.sectionById.get(m.buried[0]!.s.id)!.stageName).toBe("Engrossed in Senate");
});

test("every display edge cites claims that exist", () => {
  const m = buildModel(b);
  for (const e of m.edges) for (const c of e.claims) expect(b.claims[c]).toBeDefined();
});

test("short labels", () => {
  expect(shortName("Electronic Payments Coalition")).toBe("EPC");
  expect(shortName("American Bankers Association")).toBe("ABA");
  expect(shortName("Securities Industry and Financial Markets Association")).toBe("SIFMA");
  expect(shortName("Solana Policy Institute")).toBe("Solana");
  expect(shortName("Tether Operations S A De C V")).toBe("Tether");
  expect(shortName("THE CLEARING HOUSE ASSOCIATION")).toBe("Clearing");
  expect(memberShort(b.nodes.find((n) => n.id === "member:H000601") as never)).toBe("Hagerty R");
});
