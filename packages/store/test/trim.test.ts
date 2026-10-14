import { expect, test } from "bun:test";
import { type Bundle, checkBundle } from "@antibody/core";
import fixture from "../../core/fixtures/genius-mini.bundle.json";
import { trimEvidence } from "../src/trim.ts";

const fresh = () => structuredClone(fixture) as unknown as Bundle;

test("an edge keeps at most `cap` claims, says how many it left out, and the bundle stays sound", () => {
  const b = fresh();
  const edge = b.edges[0]!;
  edge.claims = Object.keys(b.claims).slice(0, 5);
  trimEvidence(b, 2);
  expect(edge.claims.length).toBe(2);
  expect(edge.moreClaims).toBe(3);
  expect(checkBundle(b)).toEqual([]);
});

test("claims nothing points at are dropped, those an inference rests on are kept", () => {
  const b = fresh();
  const orphan = { ...Object.values(b.claims)[0]!, id: "bills/orphan" };
  b.claims[orphan.id] = orphan;
  const total = Object.keys(b.claims).length;
  trimEvidence(b, 1000);
  expect(orphan.id in b.claims).toBe(false);
  expect(Object.keys(b.claims).length).toBe(total - 1);
  for (const c of Object.values(b.claims)) for (const r of c.restsOn) expect(r in b.claims).toBe(true);
});

test("an edge within the cap is untouched", () => {
  const b = fresh();
  trimEvidence(b);
  expect(b.edges.every((e) => e.moreClaims === undefined)).toBe(true);
});
