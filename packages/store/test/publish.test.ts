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

test("a bundle outside the curated list is marked as the watcher's, with the day it was first flagged", async () => {
  const published = await mkdtemp(join(dir, "watcher-"));
  const other: Bundle = { ...bundle, bill: { ...bundle.bill, id: "119-hr-9", display: "H.R.9" } };
  for (const b of [bundle, other]) await Bun.write(join(published, `${b.bill.id}.json`), JSON.stringify(b));
  const hot = (day: string) => ({
    id: `119-hr-9/hot/${day}`,
    bill_id: "119-hr-9",
    kind: "hot" as const,
    seen_at: `${day}T09:00:00-07:00`,
    url: "https://www.congress.gov/bill/119th-congress/house-bill/9",
    detail: {},
  });
  const index = await writeIndex(published, [bundle.bill.id], [hot("2026-10-16"), hot("2026-10-15")]);
  const [curated, watcher] = index.bills;
  expect(curated).toMatchObject({ origin: "curated", note: null, addedOn: null });
  expect(watcher).toMatchObject({ id: "119-hr-9", origin: "watcher", addedOn: "2026-10-15" });
  expect(watcher!.note).toStartWith("Added by the daily watcher and not hand-checked");
  expect(index.watch.map((p) => [p.billId, p.file])).toEqual([["119-hr-9", "119-hr-9.json"]]);
});

test("watcher bills beyond the cap are dropped, oldest added first, and curated ones are never cut", async () => {
  const published = await mkdtemp(join(dir, "cap-"));
  const make = (n: number): Bundle => ({ ...bundle, bill: { ...bundle.bill, id: `119-hr-${n}`, display: `H.R.${n}` } });
  const day = (n: number) => `2026-10-${String(10 + n).padStart(2, "0")}`;
  const events = [1, 2, 3].map((n) => ({
    id: `119-hr-${n}/hot/${day(n)}`,
    bill_id: `119-hr-${n}`,
    kind: "hot" as const,
    seen_at: `${day(n)}T09:00:00-07:00`,
    url: "https://www.congress.gov/bill/119th-congress/house-bill/1",
    detail: {},
  }));
  for (const b of [bundle, make(1), make(2), make(3)]) await writeBundle(b, { publish: true, ...where, published });
  const index = await writeIndex(published, [bundle.bill.id], events, 2);
  expect(index.bills.map((b) => b.id)).toEqual([bundle.bill.id, "119-hr-3", "119-hr-2"]);
  expect(await Bun.file(join(published, "119-hr-1.json")).exists()).toBe(false);
  expect(await Bun.file(join(published, "119-hr-1.claims.json")).exists()).toBe(false);
  expect(await Bun.file(join(published, `${bundle.bill.id}.json`)).exists()).toBe(true);
});
