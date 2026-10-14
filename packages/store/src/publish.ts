import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { type Bundle, BundleIndex } from "@antibody/core";
import { paths } from "@antibody/core/node";

/** Writes `data/bundles/<bill>.json`, and the published copy the site serves when `publish` is set. */
export async function writeBundle(bundle: Bundle, { publish = false } = {}): Promise<string[]> {
  const json = JSON.stringify(bundle);
  const dirs = publish ? [paths.bundles, paths.published] : [paths.bundles];
  const files: string[] = [];
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${bundle.bill.id}.json`);
    await Bun.write(file, json);
    files.push(file);
  }
  return files;
}

/** The last dated thing we know about the bill: enactment, a vote, a text version or an amendment action. */
export function latestActionOn(b: Bundle): string | null {
  const dates = [
    b.bill.lawOn,
    ...b.votes.map((v) => v.date),
    ...b.versions.map((v) => v.date),
    ...b.amendments.map((a) => a.latestActionOn),
  ].filter((d): d is string => !!d);
  return dates.sort().at(-1) ?? null;
}

export function indexEntry(b: Bundle): BundleIndex["bills"][number] {
  const sponsor = b.nodes.find((n) => n.id === b.bill.sponsor);
  return {
    id: b.bill.id,
    display: b.bill.display,
    title: b.bill.title,
    shortTitle: b.bill.shortTitle,
    law: b.bill.law,
    sponsorParty: sponsor?.kind === "member" ? sponsor.props.party : null,
    latestActionOn: latestActionOn(b),
    file: `${b.bill.id}.json`,
  };
}

/**
 * Rebuilds `index.json` from every bundle in `dir`: the ids in `order` first (the curated list), then the rest
 * newest first.
 */
export async function writeIndex(dir = paths.published, order: string[] = []): Promise<BundleIndex> {
  const files = (await readdir(dir).catch(() => [] as string[])).filter(
    (f) => f.endsWith(".json") && f !== "index.json",
  );
  const bills: BundleIndex["bills"] = [];
  for (const f of files) bills.push(indexEntry((await Bun.file(join(dir, f)).json()) as Bundle));
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  bills.sort((a, b) => rank(a.id) - rank(b.id) || (b.latestActionOn ?? "").localeCompare(a.latestActionOn ?? ""));
  const index = BundleIndex.parse({ generatedAt: new Date().toISOString(), bills });
  await mkdir(dir, { recursive: true });
  await Bun.write(join(dir, "index.json"), `${JSON.stringify(index, null, 1)}\n`);
  return index;
}
