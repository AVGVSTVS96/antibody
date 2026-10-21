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

test("an unnamed section's subject comes from the terms it defines, the documents and Acts it names", async () => {
  const { subjectOf } = await import("../src/match.ts");
  // H.R.5371 (P.L. 119-37) Div. B sec. 781, the hemp redefinition, as GovInfo's XML reads once tags are stripped.
  const hemp =
    "Effective 365 days after the enactment of this Act, Section 297A of the Agricultural Marketing Act of 1946 ( 7 U.S.C. 1639o ) is amended - (1) by redesignating paragraphs (2) through (6) as paragraphs (4) through (8), respectively; and (2) by striking paragraph (1) and inserting the following: (1) Hemp .- (A) In general .- The term ' hemp ' means the plant Cannabis sativa L.";
  expect(subjectOf(hemp)).toBe("hemp; Agricultural Marketing Act of 1946");
  const rule =
    'None of the funds made available by this or any other Act may be used to enforce the final rule promulgated by the Food and Drug Administration entitled "Standards for the Growing, Harvesting, Packing, and Holding of Produce for Human Consumption", and published on November 27, 2015.';
  expect(subjectOf(rule)).toBe(
    "Standards for the Growing, Harvesting, Packing, and Holding of Produce for Human Consumption",
  );
  expect(subjectOf("(a) In general .- The Secretary shall carry out this section.")).toBe("");
});

test("a model reply's JSON survives a code fence, a trailing comma and a sentence after it", async () => {
  const { parseJson } = await import("../src/llm.ts");
  expect(parseJson('```json\n[{"a":1,"s":["S1"]}]\n```')).toEqual([{ a: 1, s: ["S1"] }]);
  expect(parseJson('[\n{"a":1,"s":["S7"],},\n{"a":2,"s":[]},\n]')).toEqual([
    { a: 1, s: ["S7"] },
    { a: 2, s: [] },
  ]);
  expect(parseJson('[{"a":1}]\nArticle 2 is unrelated.')).toEqual([{ a: 1 }]);
  expect(parseJson('Here: {"a":"x, y ] }"}')).toEqual({ a: "x, y ] }" });
  // The reply that stopped the FY27 CR's x-ray: the model answered twice.
  expect(parseJson('[{"a":1,"s":["S7"]}]\n[{"a":1,"s":["S9"]}]')).toEqual([{ a: 1, s: ["S7"] }]);
});
