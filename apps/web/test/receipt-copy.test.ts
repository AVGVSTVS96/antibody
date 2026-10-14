import { expect, test } from "bun:test";
import { TEMPLATES } from "../../../packages/store/src/claims.ts";
import claimsFile from "../fixtures/119-s-1582.bundle.json";
import { claimTable, notShown, provenance, ruleId } from "../src/lib/receipt-copy.ts";

const claims = Object.values(claimsFile.claims) as { id: string; kind: "fact" | "inference"; rule: string | null }[];

test("every table the store mints claims for has its own words for what it does not show", () => {
  const generic = new Set([
    notShown({ id: "unknown/x", kind: "fact" }),
    notShown({ id: "unknown/x", kind: "inference" }),
  ]);
  for (const table of Object.keys(TEMPLATES)) {
    const own = (["fact", "inference"] as const).map((kind) => notShown({ id: `${table}/x`, kind }));
    expect(own.some((text) => !generic.has(text))).toBe(true);
  }
});

test("a claim of a known kind never gets the other kind's words", () => {
  const seen = new Set<string>();
  for (const c of claims) {
    const text = notShown(c);
    expect(text.length).toBeGreaterThan(20);
    seen.add(`${claimTable(c.id)}:${c.kind}`);
  }
  expect(seen.size).toBeGreaterThan(8);
  expect(notShown({ id: "trades/1", kind: "fact" })).toContain("routine disclosure");
  expect(notShown({ id: "resolutions/1", kind: "inference" })).toContain("matches a name to a company");
});

test("inference rules are read from the claim's rule text", () => {
  expect(ruleId({ rule: "tied-stock: the company lobbied on the bill" })).toBe("tied-stock");
  expect(ruleId({ rule: "entity-alias" })).toBe("entity-alias");
  expect(ruleId({ rule: null })).toBeNull();
});

test("the line beside the tag says how the claim was made", () => {
  expect(provenance({ kind: "fact", confidence: 1 })).toBe("READ STRAIGHT FROM THE RECORD · CONFIDENCE 1.0");
  expect(provenance({ kind: "fact", confidence: 0.9 })).toContain("SCAN");
  expect(provenance({ kind: "inference", confidence: 0.98 })).toBe("A RULE APPLIED TO RECORDS · CONFIDENCE 0.98");
});
