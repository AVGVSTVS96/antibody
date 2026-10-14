import { expect, test } from "bun:test";
import fixture from "../fixtures/genius-mini.bundle.json";
import type { Bundle } from "../src/bundle.ts";
import { claimShardOf, shardClaims } from "../src/claim-shards.ts";

const claims = (fixture as unknown as Bundle).claims;

test("shards hold every claim exactly once, and the manifest finds each one's shard", () => {
  const { manifest, shards } = shardClaims(claims, 1500);
  expect(shards.length).toBeGreaterThan(3);
  expect(Object.assign({}, ...shards)).toEqual(claims);
  expect(shards.reduce((n, s) => n + Object.keys(s).length, 0)).toBe(Object.keys(claims).length);
  for (const id of Object.keys(claims)) expect(shards[claimShardOf(manifest, id)]).toHaveProperty([id]);
});

test("shards are runs of sorted ids, so one table's rows sit together", () => {
  const { manifest, shards } = shardClaims(claims, 1500);
  expect(manifest.starts).toEqual(manifest.starts.toSorted());
  expect(manifest.starts).toEqual(shards.map((s) => Object.keys(s)[0]!));
});

test("an id before the first shard has none, and one no claim has lands in a shard that lacks it", () => {
  const { manifest, shards } = shardClaims(claims, 1500);
  expect(claimShardOf(manifest, "0/before-everything")).toBe(-1);
  expect(shards[claimShardOf(manifest, "zzz/after-everything")]).not.toHaveProperty(["zzz/after-everything"]);
  expect(claimShardOf({ starts: [], kinds: {} }, "bills/x")).toBe(-1);
});

test("the manifest says which tables hold facts, inferences or both", () => {
  const { manifest } = shardClaims(
    {
      "a/1": { ...Object.values(claims)[0]!, id: "a/1", kind: "fact" },
      "a/2": { ...Object.values(claims)[0]!, id: "a/2", kind: "fact" },
      "b/1": { ...Object.values(claims)[0]!, id: "b/1", kind: "inference" },
      "c/1": { ...Object.values(claims)[0]!, id: "c/1", kind: "fact" },
      "c/2": { ...Object.values(claims)[0]!, id: "c/2", kind: "inference" },
    },
    1500,
  );
  expect(manifest.kinds).toEqual({ a: "fact", b: "inference", c: "mixed" });
});
