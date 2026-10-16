import { expect, test } from "bun:test";
import { nearest, project, rubberBand, settleTime, springAt, springEasing } from "./spring.ts";

test("a critically damped spring approaches its target without crossing it", () => {
  const s = { zeta: 1, response: 0.4 };
  let prev = 0;
  for (let i = 1; i <= 100; i++) {
    const [x] = springAt(i / 100, 0, 0, 1, s);
    expect(x).toBeGreaterThanOrEqual(prev);
    expect(x).toBeLessThanOrEqual(1);
    prev = x;
  }
  expect(prev).toBeGreaterThan(0.99);
});

test("an underdamped spring overshoots, then settles", () => {
  const s = { zeta: 0.8, response: 0.3 };
  let peak = 0;
  for (let i = 1; i <= 200; i++) peak = Math.max(peak, springAt(i / 100, 0, 0, 1, s)[0]);
  expect(peak).toBeGreaterThan(1);
  expect(Math.abs(springAt(3, 0, 0, 1, s)[0] - 1)).toBeLessThan(0.001);
});

test("retargeting from a moving state continues where it was", () => {
  const s = { zeta: 1, response: 0.4 };
  const [x, v] = springAt(0.1, 0, 0, 1, s);
  const [x2, v2] = springAt(0, x, v, 0, s);
  expect(x2).toBe(x);
  expect(v2).toBe(v);
  expect(springAt(0.05, x, v, 0, s)[0]).toBeLessThan(x + v * 0.05);
});

test("settle time follows the response, and the easing starts at 0 and ends at 1", () => {
  const t = settleTime({ zeta: 1, response: 0.4 });
  expect(t).toBeGreaterThan(0.3);
  expect(t).toBeLessThan(0.8);
  const { easing, duration } = springEasing({ zeta: 1, response: 0.35 });
  expect(easing.startsWith("linear(0,")).toBe(true);
  expect(easing.endsWith(", 1)")).toBe(true);
  expect(duration).toBeGreaterThan(250);
});

test("rubber banding grows more slowly the further you pull, and never reaches the range", () => {
  expect(rubberBand(0, 600)).toBe(0);
  const a = rubberBand(50, 600);
  const b = rubberBand(100, 600);
  expect(a).toBeGreaterThan(0);
  expect(b - a).toBeLessThan(a);
  expect(rubberBand(1e6, 600)).toBeLessThan(600);
});

test("a flick is projected along its velocity and lands on the closest detent", () => {
  expect(project(100, 1000)).toBeCloseTo(100 + 499, 0);
  expect(project(100, 0)).toBe(100);
  expect(nearest([0, 300, 700], project(250, 800))).toBe(700);
  expect(nearest([0, 300, 700], 120)).toBe(0);
});
