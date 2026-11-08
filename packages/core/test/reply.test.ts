import { expect, test } from "bun:test";
import { z } from "zod";
import { parseJson } from "../src/reply.ts";

const json = z.json();

test("a model reply's JSON survives a code fence, a trailing comma and a sentence after it", () => {
  expect(parseJson('```json\n[{"a":1,"s":["S1"]}]\n```', json)).toEqual([{ a: 1, s: ["S1"] }]);
  expect(parseJson('[\n{"a":1,"s":["S7"],},\n{"a":2,"s":[]},\n]', json)).toEqual([
    { a: 1, s: ["S7"] },
    { a: 2, s: [] },
  ]);
  expect(parseJson('[{"a":1}]\nArticle 2 is unrelated.', json)).toEqual([{ a: 1 }]);
  expect(parseJson('Here: {"a":"x, y ] }"}', json)).toEqual({ a: "x, y ] }" });
  expect(parseJson('[{"a":1,"s":["S7"]}]\n[{"a":1,"s":["S9"]}]', json)).toEqual([{ a: 1, s: ["S7"] }]);
});
