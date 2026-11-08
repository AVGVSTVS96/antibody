import { expect, test } from "bun:test";
import { Bundle, must } from "@antibody/core";
import genius from "../fixtures/119-s-1582.bundle.json";
import type { Dot } from "../src/lib/derive.ts";
import { buildModel } from "../src/lib/model.ts";
import { frameFor, notes } from "../src/lib/scatter.ts";
import type { Placed } from "../src/lib/scatter.ts";

const view = must(buildModel(Bundle.parse(genius)).sections[0], "a fixture section");

const point = (id: string, kind: Dot["kind"], cx: number, cy: number, hits: number, musd: number): Placed => ({
  v: { ...view, s: { ...view.s, id, num: id, late: false, score: null } },
  kind,
  cx,
  cy,
  hits,
  musd,
  r: 7,
});

test("a note never lands on the chart's title lines or the quiet-and-costly label", () => {
  for (const width of [390, 1000]) {
    const f = frameFor(width);

    const placed = [
      point("a", "buried", f.l + 20, f.t + 10, 0, -149_000),
      point("b", "buried", f.l + 24, f.t + 30, 1, 90_000),
      point("c", "headline", f.l + 200, f.t + 120, 24, 30_000),
    ];

    const zone = { x: f.l + 60, y: f.t + 80 };
    const out = notes(placed, f, zone);
    expect(out.length).toBeGreaterThan(0);

    for (const n of out) {
      expect(n.y - 12).toBeGreaterThanOrEqual(38);

      if (width < 560) {
        const overlapsZoneLabel = n.y - 12 < f.t - 4 && n.y + 22 > f.t - 24 && n.x < zone.x + 110 && n.x + 120 > zone.x;
        expect(overlapsZoneLabel).toBe(false);
      }
    }
  }
});
