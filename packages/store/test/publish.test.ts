import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Bundle } from "@antibody/core";
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
  expect((await Bun.file(join(published, "index.json")).json()).bills).toHaveLength(2);
});
