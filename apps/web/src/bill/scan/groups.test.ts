import { expect, test } from "bun:test";
import { Bundle, Section, must } from "@antibody/core";
import genius from "../../../fixtures/119-s-1582.bundle.json";
import { buildModel } from "../../lib/model.ts";
import { groupSections } from "./groups.ts";

const view = must(buildModel(Bundle.parse(genius)).sections[0], "a fixture section");

const model = (paths: string[], notInFinal: string[] = []) => ({
  sections: paths.map((path, i) => ({
    ...view,
    s: { ...view.s, id: `s${i}`, path, inFinal: !notInFinal.includes(path) },
  })),
});

test("sections group by the title or division in their path, because the bundle carries no committee for a section", () => {
  expect(Object.keys(Section.shape)).not.toContain("committee");
  const g = groupSections(model(["title:I/sec:1", "division:A/sec:2", "title:I/sec:3"]));
  expect(g.map((x) => [x.key, x.sections.map((v) => v.s.id)])).toEqual([
    ["division:A", ["s1"]],
    ["title:I", ["s0", "s2"]],
  ]);
});

test("titles run in numeral order", () => {
  const g = groupSections(
    model(["title:IV/sec:1", "title:II/sec:2", "title:II/sec:3", "title:X/sec:4", "title:III/sec:5"]),
  );

  expect(g.map((x) => x.label)).toEqual(["Title II", "Title III", "Title IV", "Title X"]);
  expect(g[0]?.sections.length).toBe(2);
});

test("division keys sort shorter first, then A to Z: A to Z, then AA, BB, ...", () => {
  const g = groupSections(
    model([
      "division:BB/sec:1",
      "division:AA/title:I/sec:2",
      "division:B/sec:3",
      "division:A/sec:4",
      "division:Z/sec:5",
    ]),
  );

  expect(g.map((x) => x.label)).toEqual(["Division A", "Division B", "Division Z", "Division AA", "Division BB"]);
});

test("a bill with no titles is one group, and loose sections lead when titles exist", () => {
  expect(groupSections(model(["sec:1", "sec:2"])).map((x) => x.label)).toEqual(["The bill"]);
  const g = groupSections(model(["title:I/sec:1", "sec:2"]));
  expect(g.map((x) => x.label)).toEqual(["General sections", "Title I"]);
});

test("sections that are not in the final text are left out", () => {
  const g = groupSections(model(["title:I/sec:1", "title:I/sec:2"], ["title:I/sec:2"]));
  expect(g[0]?.sections.length).toBe(1);
});
