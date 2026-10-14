import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { type Bundle, type Claim, claimShardFile, shardClaims } from "@antibody/core";
import fixture from "../../../packages/core/fixtures/genius-mini.bundle.json";
import { loadClaims } from "../src/lib/data.ts";

const whole = fixture as unknown as Bundle;
const { manifest, shards } = shardClaims(whole.claims, 1500);
const published: Bundle = { ...whole, bill: { ...whole.bill, id: "119-hr-9999" }, claims: {}, claimShards: manifest };
const realFetch = globalThis.fetch;
let asked: string[] = [];

const served = (async (url: string) => {
  asked.push(url);
  const shard = shards[Number(/\.claims\.(\d+)\.json$/.exec(url)?.[1])];
  return shard ? Response.json(shard) : new Response("", { status: 404 });
}) as unknown as typeof fetch;
beforeAll(() => {
  globalThis.fetch = served;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});
afterEach(() => {
  asked = [];
});

test("loading a claim fetches only its shard, and each shard once", async () => {
  expect(shards.length).toBeGreaterThan(3);
  const id = Object.keys(shards.at(-1)!)[0]!;
  const found = await loadClaims(published, [id]);
  expect(found[id]).toEqual(whole.claims[id] as Claim);
  expect(asked).toEqual([`/bundles/${claimShardFile(published.bill.id, shards.length - 1)}`]);
  await loadClaims(published, [id, Object.keys(shards.at(-1)!).at(-1)!]);
  expect(asked).toHaveLength(1);
});

test("ids in several shards fetch each of them; an id no shard holds fetches nothing", async () => {
  const ids = [Object.keys(shards[0]!)[0]!, Object.keys(shards[1]!)[0]!];
  expect(Object.keys(await loadClaims(published, ids))).toEqual(expect.arrayContaining(ids));
  expect(asked.toSorted()).toEqual([0, 1].map((i) => `/bundles/${claimShardFile(published.bill.id, i)}`));
  asked = [];
  expect(await loadClaims(published, ["0/before-everything"])).toEqual({});
  expect(asked).toEqual([]);
});

test("a bundle that still has its claims needs no request", async () => {
  expect(await loadClaims(whole, Object.keys(whole.claims))).toBe(whole.claims);
  expect(asked).toEqual([]);
});

test("a shard that fails to load is tried again next time", async () => {
  const broken: Bundle = { ...published, bill: { ...published.bill, id: "119-hr-9998" } };
  const id = Object.keys(shards[0]!)[0]!;
  globalThis.fetch = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
  await expect(loadClaims(broken, [id])).rejects.toThrow("503");
  globalThis.fetch = served;
  expect((await loadClaims(broken, [id]))[id]).toBeDefined();
});
