import { expect, test } from "bun:test";
import type { BillModel } from "../../lib/model.ts";
import { groupSections } from "./groups.ts";

const model = (paths: (string | [string, boolean])[]) =>
  ({
    sections: paths.map((p, i) => {
      const [path, inFinal] = typeof p === "string" ? [p, true] : p;
      return { s: { id: `s${i}`, path, inFinal } };
    }),
  }) as unknown as BillModel;

test("sections group by the title or division they sit in, in numeral order", () => {
  const g = groupSections(
    model(["title:IV/sec:1", "title:II/sec:2", "title:II/sec:3", "title:X/sec:4", "title:III/sec:5"]),
  );
  expect(g.map((x) => x.label)).toEqual(["Title II", "Title III", "Title IV", "Title X"]);
  expect(g[0]!.sections.length).toBe(2);
});

test("divisions run A to Z, then AA", () => {
  const g = groupSections(
    model(["division:AA/title:I/sec:1", "division:B/sec:2", "division:A/sec:3", "division:Z/sec:4"]),
  );
  expect(g.map((x) => x.label)).toEqual(["Division A", "Division B", "Division Z", "Division AA"]);
});

test("a bill with no titles is one group, and loose sections lead when titles exist", () => {
  expect(groupSections(model(["sec:1", "sec:2"])).map((x) => x.label)).toEqual(["The bill"]);
  const g = groupSections(model(["title:I/sec:1", "sec:2"]));
  expect(g.map((x) => x.label)).toEqual(["General sections", "Title I"]);
});

test("sections that are not in the final text are left out", () => {
  const g = groupSections(model(["title:I/sec:1", ["title:I/sec:2", false]]));
  expect(g[0]!.sections.length).toBe(1);
});
