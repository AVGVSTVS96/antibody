import { expect, test } from "bun:test";
import fixture from "../fixtures/genius-mini.bundle.json";
import { Bundle, checkBundle } from "../src/bundle.ts";

test("the fixture is a valid, sound bundle", () => {
  const parsed = Bundle.safeParse(fixture);
  if (!parsed.success) throw new Error(parsed.error.message);
  expect(checkBundle(parsed.data)).toEqual([]);
});

test("checkBundle catches a dangling claim and edge", () => {
  const b = Bundle.parse(fixture);
  const broken = structuredClone(b);
  broken.edges.push({ ...b.edges[0]!, id: "x", dst: "member:NOPE", claims: ["trades/missing"] } as never);
  expect(checkBundle(broken)).toEqual([
    "edge x: unknown dst member:NOPE",
    ".edges[4].claims: unknown claim trades/missing",
  ]);
});
