import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Bundle, claimShardFile, claimShardOf, indexTotals } from "@antibody/core";
import fixture from "../../core/fixtures/genius-mini.bundle.json";
import { indexEntry, writeBundle, writeIndex } from "../src/publish.ts";

const dir = await mkdtemp(join(tmpdir(), "antibody-publish-"));
afterAll(() => rm(dir, { recursive: true, force: true }));
const bundle = fixture as unknown as Bundle;
const where = { local: join(dir, "local"), published: join(dir, "published") };

test("a published copy that differs only in generatedAt is left alone", async () => {
  const [, pub] = await writeBundle(bundle, { publish: true, ...where });
  const first = (await stat(pub!)).mtimeMs;
  await Bun.sleep(20);
  await writeBundle({ ...bundle, generatedAt: "2030-01-01T00:00:00.000Z" }, { publish: true, ...where });
  expect((await stat(pub!)).mtimeMs).toBe(first);
  await writeBundle({ ...bundle, bill: { ...bundle.bill, title: "Changed" } }, { publish: true, ...where });
  expect((await stat(pub!)).mtimeMs).toBeGreaterThan(first);
});

test("the published bundle holds no claims, its shards hold all of them, and shards of an older build are removed", async () => {
  const published = await mkdtemp(join(dir, "shards-"));
  const id = bundle.bill.id;
  const stale = [`${id}.claims.json`, claimShardFile(id, 9)];
  for (const f of stale) await Bun.write(join(published, f), "{}");
  await writeBundle(bundle, { publish: true, local: join(published, "local"), published });
  const slim = (await Bun.file(join(published, `${id}.json`)).json()) as Bundle;
  expect(slim.claims).toEqual({});
  const shards = await Promise.all(
    slim.claimShards!.starts.map((_, i) => Bun.file(join(published, claimShardFile(id, i))).json()),
  );
  expect(Object.assign({}, ...shards)).toEqual(bundle.claims);
  for (const claim of Object.keys(bundle.claims))
    expect(shards[claimShardOf(slim.claimShards!, claim)]).toHaveProperty([claim]);
  for (const f of stale) expect(await Bun.file(join(published, f)).exists()).toBe(false);
  expect((await Bun.file(join(published, "local", `${id}.json`)).json()).claims).toEqual(bundle.claims);
  expect((await writeIndex(published, [], [])).bills.map((b) => b.id)).toEqual([id]);
});

test("the index lists the published bundles, curated ids first", async () => {
  const index = await writeIndex(where.published, [bundle.bill.id], []);
  expect(index.bills.map((b) => b.id)).toEqual([bundle.bill.id]);
  expect(index.bills[0]!.file).toBe(`${bundle.bill.id}.json`);
});

test("an index lists the curated ids first, in that order, and says what each bundle holds", async () => {
  const published = await mkdtemp(join(dir, "index-"));
  const other: Bundle = { ...bundle, bill: { ...bundle.bill, id: "117-hr-5376", display: "H.R.5376" } };
  for (const b of [bundle, other]) await Bun.write(join(published, `${b.bill.id}.json`), JSON.stringify(b));
  const index = await writeIndex(published, ["117-hr-5376", bundle.bill.id], []);
  expect(index.bills.map((b) => b.id)).toEqual(["117-hr-5376", bundle.bill.id]);
  expect(index.bills[1]).toEqual(indexEntry(bundle));
  expect(index.watch).toEqual([]);
  expect(index.totals).toEqual(indexTotals([bundle, other]));
  expect((await Bun.file(join(published, "index.json")).json()).bills).toHaveLength(2);
});

test("the article list is published beside the bundle, referenced from the index, and absent when empty", async () => {
  const published = await mkdtemp(join(dir, "articles-"));
  const where = { local: join(published, "local"), published };
  const claim = Object.keys(bundle.claims)[0]!;
  const list = {
    schema: 1 as const,
    billId: bundle.bill.id,
    articles: [{ url: "https://a.example/x", outlet: "A", group: "left", title: "T", date: null, claim }],
    bySection: {},
    general: [0],
  };
  await writeBundle(bundle, { publish: true, articles: list, ...where });
  expect(await Bun.file(join(published, `${bundle.bill.id}.articles.json`)).json()).toEqual(list);
  expect((await writeIndex(published, [], [])).bills[0]!.articlesFile).toBe(`${bundle.bill.id}.articles.json`);
  await writeBundle(bundle, { publish: true, articles: { ...list, articles: [], general: [] }, ...where });
  expect((await writeIndex(published, [], [])).bills[0]!.articlesFile).toBeNull();
});
