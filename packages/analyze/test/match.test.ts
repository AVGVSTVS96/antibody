import { expect, test } from "bun:test";
import type { Row } from "@antibody/core";
import { menu } from "../src/match.ts";

const section = (n: number, over: Partial<Row<"sections">> = {}) =>
  ({
    id: `119-s-1@a:${n}`,
    num: String(n),
    heading: `Heading ${n}`,
    preview: "one two three",
    in_final: true,
    ...over,
  }) as Row<"sections">;

test("a menu keys each section S1..Sn and maps the keys back to section ids", () => {
  const m = menu([section(1), section(2, { in_final: false })]);
  expect(m.ids.get("S2")).toBe("119-s-1@a:2");
  expect(m.text.split("\n")).toEqual([
    "S1 | sec. 1 | Heading 1 | one two three",
    "S2 | sec. 2 | Heading 2 [dropped before the final text] | one two three",
  ]);
});

test("a shortlist menu keys its own sections from S1, so a key means one section per article", () => {
  const m = menu([section(7), section(9)]);
  expect([...m.ids.keys()]).toEqual(["S1", "S2"]);
  expect(m.ids.get("S1")).toBe("119-s-1@a:7");
});
