import { expect, test } from "bun:test";
import { Bundle, checkBundle } from "@antibody/core";
import genius from "../fixtures/119-s-1582.bundle.json";
import { plainName } from "../src/lib/format.ts";
import { buildModel, closestToQuiet, memberShort } from "../src/lib/model.ts";

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
  expect(plainName("GENERAL MOTORS CO")).toBe("General Motors");
  expect(plainName("JOHNSON & JOHNSON")).toBe("Johnson & Johnson");
  expect(plainName("Tether Operations S A De C V")).toBe("Tether Operations");
  expect(plainName("Pharmaceutical Research and Manufacturers of America", 18)).toBe("Pharmaceutical…");
  expect(plainName("THE CLEARING HOUSE ASSOCIATION")).toBe("Clearing House…");
  expect(memberShort(b.nodes.find((n) => n.id === "member:H000601") as never)).toBe("Hagerty R");
});

const withDropped = () => {
  const x = Bundle.parse(structuredClone(genius));
  const final = x.sections.find((s) => s.num === "4")!;
  x.sections.push({
    ...structuredClone(final),
    id: `${final.id}-old`,
    inFinal: false,
    firstVersion: x.versions[0]!.code,
  });
  return buildModel(x);
};

test("a final section is a bare number; a dropped one that shares it says so, and the number names the final one", () => {
  const m = withDropped();
  const final = m.sections.find((v) => v.s.num === "4" && v.s.inFinal)!;
  const dropped = m.sections.find((v) => v.s.num === "4" && !v.s.inFinal)!;
  expect(m.secLabel(final)).toBe("§4");
  expect(m.secLabel(dropped)).toBe("§4, dropped before passage");
  expect(m.sectionSlug(final)).toBe("4");
  expect(m.sectionSlug(dropped)).toBe(dropped.s.id);
  expect(m.sectionBySlug("4")).toBe(final);
  expect(m.sectionBySlug(dropped.s.id)).toBe(dropped);
});

test("a section's named count is its score's, and drawn is the part from drawn clients", () => {
  const m = buildModel(b);
  for (const v of m.sections.filter((x) => x.s.score)) {
    expect(v.named).toBe(v.s.score!.components.lobbyingReports);
    expect(v.drawn).toBeLessThanOrEqual(v.named);
  }
});

test("the closest section to quiet-and-costly has a score above zero and names what it lacks", () => {
  const x = Bundle.parse(structuredClone(genius));
  expect(closestToQuiet(buildModel(x))).toBeUndefined();
  const s = x.sections.find((v) => v.inFinal && v.score && v.score.label === "normal")!;
  s.score!.buried = 0.85;
  s.score!.components.late = false;
  s.score!.components.lobbyingReports = 0;
  s.score!.components.dollarsMusd = null;
  const near = closestToQuiet(buildModel(x))!;
  expect(near.v.s.id).toBe(s.id);
  expect(near.score).toBe(0.85);
  expect(near.missed.some((w) => /not added late/.test(w))).toBe(true);
  expect(near.missed.some((w) => /stakes/.test(w))).toBe(true);
});
