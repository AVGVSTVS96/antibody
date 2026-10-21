import { expect, test } from "bun:test";
import { parseJson } from "../src/reply.ts";

test("a model reply's JSON survives a code fence, a trailing comma and a sentence after it", () => {
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
