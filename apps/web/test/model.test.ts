import { expect, test } from "bun:test";
import { Bundle, checkBundle } from "@antibody/core";
import genius from "../fixtures/119-s-1582.bundle.json";
import { nice, plainName } from "../src/lib/format.ts";
import { buildModel, memberShort } from "../src/lib/model.ts";

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

test("FEC and SEC names keep their acronyms and numerals, and never leave a parenthesis open", () => {
  expect(nice("CMS ENERGY CORPORATION EMPLOYEES FOR BETTER GOVERNMENT- FEDERAL")).toBe(
    "CMS Energy Corporation Employees For Better Government- Federal",
  );
  expect(nice("DTE ENERGY COMPANY POLITICAL ACTION COMMITTEE")).toBe("DTE Energy Company Political Action Committee");
  expect(nice("WELLS FARGO AND COMPANY EMPLOYEES GOOD GOVERNMENT FEDERAL FUND II")).toContain("Federal Fund II");
  expect(nice("AT&T INC.")).toBe("AT&T Inc.");
  expect(nice("FRANKLIN TEMPLETON INC. POLITICAL ACTION COMMITTEE (FRANKLIN TEMPLETON PAC")).toBe(
    "Franklin Templeton Inc. Political Action Committee (Franklin Templeton PAC)",
  );
  expect(nice("Already Mixed Case Inc")).toBe("Already Mixed Case Inc");
  expect(plainName("PNC FINANCIAL SERVICES GROUP, INC. (PNC PAC)", 30)).toBe("PNC Financial Services Group…");
});

test("short labels", () => {
  expect(plainName("GENERAL MOTORS CO")).toBe("General Motors");
  expect(plainName("JOHNSON & JOHNSON")).toBe("Johnson & Johnson");
  expect(plainName("Tether Operations S A De C V")).toBe("Tether Operations");
  expect(plainName("Pharmaceutical Research and Manufacturers of America", 18)).toBe("Pharmaceutical…");
  expect(plainName("THE CLEARING HOUSE ASSOCIATION")).toBe("Clearing House…");
  expect(memberShort(b.nodes.find((n) => n.id === "member:H000601") as never)).toBe("Hagerty R");
  const member = (label: string, party: string) => ({ label, props: { party } }) as never;
  expect(memberShort(member("Rep. Frank Pallone, Jr. (D-NJ)", "D"))).toBe("Pallone D");
  expect(memberShort(member("Rep. Rudy Yakym III (R-IN)", "R"))).toBe("Yakym R");
  expect(memberShort(member("Rep. William R. Timmons IV (R-SC)", "R"))).toBe("Timmons R");
});
