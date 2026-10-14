import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { type BillId, type Bundle, BundleIndex, billDisplay, billStats } from "@antibody/core";
import { paths, readRows } from "@antibody/core/node";

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

const sponsorParty = (b: Bundle) => {
  const sponsor = b.nodes.find((n) => n.id === b.bill.sponsor);
  return sponsor?.kind === "member" ? sponsor.props.party : null;
};

export function indexEntry(b: Bundle): BundleIndex["bills"][number] {
  return {
    id: b.bill.id,
    display: b.bill.display,
    title: b.bill.title,
    shortTitle: b.bill.shortTitle,
    law: b.bill.law,
    sponsorParty: sponsorParty(b),
    latestActionOn: latestActionOn(b),
    file: `${b.bill.id}.json`,
    stats: billStats(b),
  };
}

/** The watcher's latest picks (its "hot" events from the newest run), linked to a bundle when one is published. */
async function watchPicks(bundles: Map<string, Bundle>): Promise<BundleIndex["watch"]> {
  const hot = (await readRows("watch_events")).filter((e) => e.kind === "hot");
  const latest = hot
    .map((e) => e.seen_at)
    .sort()
    .at(-1);
  return hot
    .filter((e) => e.seen_at === latest)
    .sort((a, b) => Number(b.detail.score ?? 0) - Number(a.detail.score ?? 0))
    .map((e) => {
      const b = bundles.get(e.bill_id);
      return {
        billId: e.bill_id,
        display: b?.bill.display ?? billDisplay(e.bill_id as BillId),
        title: b?.bill.shortTitle ?? b?.bill.title ?? billDisplay(e.bill_id as BillId),
        kind: e.kind,
        seenAt: e.seen_at,
        url: e.url,
        reason: typeof e.detail.reason === "string" ? e.detail.reason : null,
        sponsorParty: b ? sponsorParty(b) : null,
        file: b ? `${e.bill_id}.json` : null,
      };
    });
}

/**
 * Rebuilds `index.json` from every bundle in `dir`: the ids in `order` first (the curated list), then the rest
 * newest first, plus the watcher's latest picks.
 */
export async function writeIndex(dir = paths.published, order: string[] = []): Promise<BundleIndex> {
  const files = (await readdir(dir).catch(() => [] as string[])).filter(
    (f) => f.endsWith(".json") && f !== "index.json",
  );
  const bundles = new Map<string, Bundle>();
  for (const f of files) {
    const b = (await Bun.file(join(dir, f)).json()) as Bundle;
    bundles.set(b.bill.id, b);
  }
  const bills = [...bundles.values()].map(indexEntry);
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  bills.sort((a, b) => rank(a.id) - rank(b.id) || (b.latestActionOn ?? "").localeCompare(a.latestActionOn ?? ""));
  const index = BundleIndex.parse({ generatedAt: new Date().toISOString(), bills, watch: await watchPicks(bundles) });
  await mkdir(dir, { recursive: true });
  await Bun.write(join(dir, "index.json"), `${JSON.stringify(index, null, 1)}\n`);
  return index;
}
