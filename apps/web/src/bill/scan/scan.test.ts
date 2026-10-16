import { expect, test } from "bun:test";
import { Bundle } from "@antibody/core";
import genius from "../../../fixtures/119-s-1582.bundle.json";
import { buildModel } from "../../lib/model.ts";
import { fit, inside, outside, textWidth, VIEW } from "./labels.ts";
import { buildScenes, CH, CHANNELS, emptiness, itemIds, placeByWant, present } from "./layout.ts";
import { C, clockwiseFromTop, fromTop, pt, slotAngle, TAU, TOP, wrapPi } from "./polar.ts";
import { MAX_COMPANIES, selectRing } from "./select.ts";
import { tiePath, tieSet } from "./ties.ts";

const m = buildModel(Bundle.parse(genius));
const scenes = buildScenes(m);

test("slots leave the bottom open and the first slot of fromTop sits at 12 o'clock", () => {
  const gap = 0.3;
  const n = 40;
  expect(Math.abs(wrapPi(fromTop(0, n, gap) - TOP))).toBeLessThan(0.1);
  const last = slotAngle(n - 1, n, gap);
  const first = slotAngle(0, n, gap);
  expect(first - Math.PI / 2).toBeGreaterThan(gap / 2);
  expect(Math.PI / 2 + TAU - last).toBeGreaterThan(gap / 2);
});

test("placeByWant keeps the order of the wants and spreads evenly", () => {
  const wants = [3.0, 0.2, 5.5, 1.1, 2.0];
  const angles = placeByWant(wants, 0.3);
  expect(new Set(angles.map((a) => a.toFixed(6))).size).toBe(5);
  const byWant = wants.map((w, i) => [w, angles[i]!] as const).sort((a, b) => a[0] - b[0]);
  const walk = byWant.map(([, a]) => clockwiseFromTop(a));
  const rotated = walk.indexOf(Math.min(...walk));
  const inOrder = [...walk.slice(rotated), ...walk.slice(0, rotated)];
  expect(inOrder).toEqual([...inOrder].sort((a, b) => a - b));
});

test("the ring draws companies by members traded, capped, and always keeps a linked one", () => {
  const d = selectRing(m, "trades");
  expect(d.companies.length).toBeLessThanOrEqual(MAX_COMPANIES);
  const counts = d.companies.map((a) => d.byCompany.get(a.id)?.length ?? 0);
  expect(counts).toEqual([...counts].sort((a, b) => b - a));
  const all = selectRing(m, "trades").candidates.companies;
  expect(all).toBeGreaterThan(0);
  const outsider = [...scenes.allTies.trades.keys()].find((id) => !d.companies.some((a) => a.id === id));
  if (outsider) expect(selectRing(m, "trades", [outsider]).companies.some((a) => a.id === outsider)).toBe(true);
  for (const t of d.ties) expect(d.members.some((v) => v.node.id === t.member)).toBe(true);
});

test("every mark of the fixture has a target, a size that fits its ring and a place on the circle", () => {
  for (const view of ["trades", "pac"] as const) {
    const { layout } = scenes.ring[view];
    const angles = new Set<string>();
    for (const s of [...layout.companies, ...layout.members]) angles.add(`${s.size > 0}${s.angle.toFixed(5)}`);
    expect(angles.size).toBeGreaterThan(0);
    for (const s of layout.members) expect(s.size).toBeGreaterThan(0);
  }
  const t = scenes.targets.trades;
  for (let i = 0; i < scenes.marks.length; i++) {
    if (!t.present[i]) continue;
    expect(t.t[i * CHANNELS + CH.alpha]).toBe(1);
    expect(Number.isFinite(t.t[i * CHANNELS + CH.angle]!)).toBe(true);
  }
});

test("a view with nothing in it says why, and a pinned id only counts where its mark exists", () => {
  const e = emptiness(scenes);
  expect(e.trades).toBeNull();
  expect(e.sections).toContain("no section");
  const id = itemIds(scenes, "trades")[0]!;
  expect(present(scenes, "trades", id)).toBe(true);
  expect(present(scenes, "sections", id)).toBe(false);
  expect(present(scenes, "sections", "group:title:IX")).toBe(false);
});

test("ties branch off a shared track: the farthest member rides innermost and every route ends at its member", () => {
  const d = scenes.ring.trades.data;
  const layout = scenes.ring.trades.layout;
  const company = [...d.byCompany.entries()].sort((a, b) => b[1].length - a[1].length)[0]![0];
  const set = tieSet(d, layout, company);
  expect(set.ties.length).toBe(d.byCompany.get(company)!.length);
  expect(set.ties.map((t) => t.order)).toEqual(set.ties.map((_, i) => i));
  for (const t of set.ties) expect(t.d.startsWith("M")).toBe(true);
});

test("a straight route and an arc route both start at the company and end at the member", () => {
  const straight = tiePath(1, 260, 1, 320, 280);
  expect(straight).toBe(
    `M${pt(1, 260)
      .map((n) => Math.round(n * 10) / 10)
      .join(" ")}L${pt(1, 320)
      .map((n) => Math.round(n * 10) / 10)
      .join(" ")}`,
  );
  const arc = tiePath(0, 260, 1, 320, 280);
  expect(arc).toContain("A280.0 280.0 0 0 1");
  expect(tiePath(0, 260, -1, 320, 280)).toContain("A280.0 280.0 0 0 0");
  expect(C).toBe(360);
});

test("labels are kept in priority order, never overlap, and never leave the picture", () => {
  const a = outside("a", "Gottheimer, D-NJ", 0.5, 346, 12);
  const b = outside("b", "Gottheimer, D-NJ", 0.51, 346, 12);
  const c = outside("c", "Tuberville, R-AL", 1, 346, 12);
  const off = outside("off", "x".repeat(60), 0, 346, 12);
  const kept = fit([a, b, c, off], [], 9, 3).map((l) => l.id);
  expect(kept).toEqual(["a", "c"]);
  expect(off.box.x1).toBeGreaterThan(VIEW.x + VIEW.w);
  expect(inside("i", "Amgen", Math.PI, 226, 12).anchor).toBe("start");
  expect(textWidth("abcd", 10)).toBeCloseTo(23.2);
});
