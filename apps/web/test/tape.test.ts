import { expect, test } from "bun:test";
import { Bundle } from "@antibody/core";
import genius from "../fixtures/119-s-1582.bundle.json";
import { buildModel } from "../src/lib/model.ts";
import { buildTape, geometry, indexAt, layout, logHeight, quietRun, runNote } from "../src/lib/tape.ts";

const fresh = () => Bundle.parse(structuredClone(genius));
const tapeOf = (b: Bundle) => buildTape(buildModel(b));

function withDollars(b: Bundle, figures: Record<string, [number, "exact" | "even_split"]>) {
  const est = { ...b.dollars.estimates[0]!, id: "est-1", perSection: true, baseline: "current-law" as const };
  b.dollars.estimates = [est];
  for (const s of b.sections) {
    const f = figures[s.num];
    s.dollars = f
      ? [
          {
            estimateId: est.id,
            baseline: "current-law",
            measure: "deficit",
            period: "2025-2034",
            amountMusd: f[0],
            split: f[1],
            claim: s.claims[0]!,
          },
        ]
      : [];
  }
  return b;
}

test("rows come in the law's order whatever order the bundle lists sections in", () => {
  const b = fresh();
  b.sections.reverse();
  b.sections.forEach((s, i) => {
    s.path = i % 2 ? `title:II/sec:${s.num}` : `title:I/sec:${s.num}`;
  });
  const t = tapeOf(b);
  expect(t.rows.map((r) => r.group)).toEqual(t.rows.map((r) => r.group).sort());
  expect(t.groups.map((g) => g.label)).toEqual(["Title I", "Title II"]);
  expect(t.groups.reduce((n, g) => n + g.count, 0)).toBe(20);
  expect(t.groups[0]!.to + 1).toBe(t.groups[1]!.from);
});

test("kinds come from the bundle's scores, and a bill with no section dollars is flat", () => {
  const t = tapeOf(fresh());
  expect(t.rows.map((r) => r.num)).toEqual(Array.from({ length: 20 }, (_, i) => `${i + 1}`));
  expect(t.rows.filter((r) => r.kind === "headline").map((r) => r.num)).toEqual(["4", "5", "17"]);
  expect(t.rows.filter((r) => r.kind === "quiet").map((r) => r.num)).toEqual(["19"]);
  expect(t.flat).toBe(true);
  expect(t.noFigure).toBe(20);
  expect(t.groups).toEqual([]);
  expect(t.rows[0]!.routeId).toBe("1");
});

test("late flags, and their absence on a shell bill", () => {
  const b = fresh();
  expect(
    tapeOf(b)
      .rows.filter((r) => r.late)
      .map((r) => r.num),
  ).toEqual(["19"]);
  b.bill.lateUnavailable = "began as a shell";
  const t = tapeOf(b);
  expect(t.lateKnown).toBe(false);
  expect(t.rows.some((r) => r.late)).toBe(false);
});

test("signed dollars, the even-split flag and the no-figure stub", () => {
  const t = tapeOf(withDollars(fresh(), { "4": [-2500, "exact"], "19": [7600, "even_split"] }));
  const by = (n: string) => t.rows.find((r) => r.num === n)!;
  expect(by("4").musd).toBe(-2500);
  expect(by("4").evenSplit).toBe(false);
  expect(by("19").musd).toBe(7600);
  expect(by("19").evenSplit).toBe(true);
  expect(by("5").musd).toBeNull();
  expect(t.flat).toBe(false);
  expect(t.noFigure).toBe(18);
  expect(t.evenSplit).toBe(1);
});

test("a section number shared by two sections routes by full id", () => {
  const b = fresh();
  b.sections[1]!.num = b.sections[0]!.num;
  const t = tapeOf(b);
  expect(t.rows.filter((r) => r.num === "1").every((r) => r.routeId === r.id)).toBe(true);
  expect(t.rows.find((r) => r.num === "3")!.routeId).toBe("3");
});

test("heights follow the designer's log scale on one key for every bill", () => {
  const g = geometry(false, false);
  expect(g.height).toBe(150);
  expect(logHeight(2_193_378, g)).toBe(58);
  expect(logHeight(1e3, g)).toBe(27);
  expect(logHeight(1e5, g)).toBe(45);
  expect(logHeight(-1, g)).toBe(9);
  expect(geometry(true, false).height).toBe(90);
});

test("adds rise from the baseline, cuts hang from it, a missing figure is a stub", () => {
  const t = tapeOf(withDollars(fresh(), { "4": [-2500, "exact"], "5": [2500, "exact"] }));
  const g = geometry(false, false);
  const marks = layout(t, 1328, g);
  const [cut, add, none] = [marks[3]!, marks[4]!, marks[5]!];
  expect(cut.y).toBe(g.mid);
  expect(add.y + add.h).toBe(g.mid);
  expect(cut.h).toBe(add.h);
  expect(none.stub).toBe(true);
});

test("marks never overlap on a roomy tape, never get thinner than 2px on a crowded one, and stay inside it", () => {
  const t = tapeOf(fresh());
  const roomy = layout(t, 1328, geometry(false, true));
  expect(roomy.every((m, i) => i === 0 || m.x >= roomy[i - 1]!.x + roomy[i - 1]!.w)).toBe(true);
  const crowded = layout(t, 30, geometry(true, true));
  expect(crowded.every((m) => m.w >= 2)).toBe(true);
  expect(roomy.at(-1)!.x + roomy.at(-1)!.w).toBeLessThanOrEqual(1328);
});

test("a flat tape shows kind, not cost: normal marks short, headline and quiet full", () => {
  const t = tapeOf(fresh());
  const marks = layout(t, 1328, geometry(false, true));
  expect(new Set(marks.filter((_, i) => t.rows[i]!.kind === "other").map((m) => m.h)).size).toBe(1);
  expect(marks[3]!.h).toBeGreaterThan(marks[0]!.h);
  expect(marks[18]!.h).toBe(marks[3]!.h);
});

test("the pointer finds the section under it", () => {
  expect(indexAt(0, 1000, 10)).toBe(0);
  expect(indexAt(99, 1000, 10)).toBe(0);
  expect(indexAt(100, 1000, 10)).toBe(1);
  expect(indexAt(5000, 1000, 10)).toBe(9);
  expect(indexAt(-5, 1000, 10)).toBe(0);
});

test("the run note is worked out from the marks", () => {
  const b = fresh();
  b.sections.forEach((s) => {
    if (s.score) s.score.label = "normal";
  });
  const quiet = ["3", "4", "6", "7", "8", "9"];
  for (const s of b.sections) if (quiet.includes(s.num)) s.score = { ...b.sections[18]!.score!, label: "buried" };
  withDollars(b, { "3": [1000, "exact"], "4": [-5000, "exact"], "6": [2000, "even_split"], "7": [9000, "exact"] });
  const t = tapeOf(b);
  const run = quietRun(t)!;
  expect([run.from, run.to]).toEqual([2, 8]);
  const note = runNote(run, t);
  expect(note.startsWith("Six yellow marks in one run: 3 add, 1 cut, $1.0B to $9.0B each, 2 with no CBO figure")).toBe(
    true,
  );
  expect(note).toContain("1 of the figures an even split (inference)");
});

test("two quiet marks are not a run", () => {
  expect(quietRun(tapeOf(fresh()))).toBeNull();
});
