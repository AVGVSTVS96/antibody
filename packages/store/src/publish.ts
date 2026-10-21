import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { type BillId, type Bundle, BundleIndex, billDisplay, billStats, type Row } from "@antibody/core";
import { paths, readRows } from "@antibody/core/node";

const STAMP = /"generatedAt":"[^"]*"/;

const claimsFile = (id: string) => `${id}.claims.json`;

/**
 * Writes `data/bundles/<bill>.json`, and the published copy the site serves when `publish` is set. The published
 * copy keeps its claims in a sidecar, `<bill>.claims.json`, so the page can paint before the largest part of the
 * bundle arrives. A published file that differs only in `generatedAt` stays as it is, so a daily rebuild commits
 * only what changed.
 */
export async function writeBundle(
  bundle: Bundle,
  { publish = false, local = paths.bundles, published = paths.published } = {},
): Promise<string[]> {
  const dirs = publish ? [local, published] : [local];
  const files: string[] = [];
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
    const split = dir === published;
    const parts: [string, string][] = split
      ? [
          [`${bundle.bill.id}.json`, JSON.stringify({ ...bundle, claims: {} })],
          [claimsFile(bundle.bill.id), JSON.stringify(bundle.claims)],
        ]
      : [[`${bundle.bill.id}.json`, JSON.stringify(bundle)]];
    for (const [name, json] of parts) {
      const file = join(dir, name);
      const old = split
        ? await Bun.file(file)
            .text()
            .catch(() => null)
        : null;
      if (old?.replace(STAMP, "") !== json.replace(STAMP, "")) await Bun.write(file, json);
    }
    files.push(join(dir, `${bundle.bill.id}.json`));
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

export interface Provenance {
  origin: "curated" | "watcher";
  note: string | null;
  addedOn: string | null;
}

export const CURATED_PROVENANCE: Provenance = { origin: "curated", note: null, addedOn: null };

export function indexEntry(b: Bundle, provenance: Provenance = CURATED_PROVENANCE): BundleIndex["bills"][number] {
  return {
    id: b.bill.id,
    display: b.bill.display,
    title: b.bill.title,
    shortTitle: b.bill.shortTitle,
    law: b.bill.law,
    sponsorParty: sponsorParty(b),
    congress: b.bill.congress,
    latestActionOn: latestActionOn(b),
    file: `${b.bill.id}.json`,
    claimsFile: claimsFile(b.bill.id),
    stats: billStats(b),
    ...provenance,
  };
}

const partyOf = (p: unknown) => (p === "R" || p === "D" || p === "I" ? p : null);

/** The watcher's latest picks (its "hot" events from the newest run), linked to a bundle when one is published. */
async function watchPicks(bundles: Map<string, Bundle>, events: Row<"watch_events">[]): Promise<BundleIndex["watch"]> {
  const hot = events.filter((e) => e.kind === "hot");
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
        title:
          b?.bill.shortTitle ??
          b?.bill.title ??
          (typeof e.detail.title === "string" ? e.detail.title : billDisplay(e.bill_id as BillId)),
        kind: e.kind,
        seenAt: e.seen_at,
        url: e.url,
        reason: typeof e.detail.reason === "string" ? e.detail.reason : null,
        sponsorParty: b ? sponsorParty(b) : partyOf(e.detail.sponsorParty),
        file: b ? `${e.bill_id}.json` : null,
      };
    });
}

function watcherNote(b: Bundle): string {
  const { buriedTest, cboPublished } = billStats(b);
  const thin = [
    ...(buriedTest.tested ? [] : [`buried sections were not ranked (${buriedTest.why})`]),
    ...(cboPublished ? [] : ["no CBO estimate was found, so no dollar figures show"]),
  ];
  return `Added by the watcher (the daily watch, or its sweep that scores every bill of a Congress on its whole record) and not hand-checked; sponsor, law status and company matches come straight from the automated run${thin.map((t) => `; ${t}`).join("")}.`;
}

function watcherProvenance(b: Bundle, events: Row<"watch_events">[]): Provenance {
  const first = events
    .filter((e) => e.bill_id === b.bill.id && e.kind === "hot")
    .map((e) => e.seen_at.slice(0, 10))
    .sort()[0];
  return { origin: "watcher", note: watcherNote(b), addedOn: first ?? b.generatedAt.slice(0, 10) };
}

/** How many watcher bills the library keeps; the newest by `addedOn` stay, older bundles are deleted from the published folder. */
export const WATCHER_KEEP = 60;

const bundleFiles = (id: string) => [`${id}.json`, claimsFile(id)];

/**
 * Rebuilds `index.json` from every bundle in `dir`: the ids in `order` first (the curated list, in that order),
 * then the watcher's bills newest added first. Watcher bills beyond `keep` are dropped from the index and their
 * files deleted; curated bills are never touched. Also lists the watcher's latest picks.
 */
export async function writeIndex(
  dir = paths.published,
  order: string[] = [],
  events?: Row<"watch_events">[],
  keep = WATCHER_KEEP,
): Promise<BundleIndex> {
  const watched = events ?? (await readRows("watch_events"));
  const files = (await readdir(dir).catch(() => [] as string[])).filter(
    (f) => f.endsWith(".json") && f !== "index.json" && !f.endsWith(".claims.json"),
  );
  const found: Bundle[] = [];
  for (const f of files) found.push((await Bun.file(join(dir, f)).json()) as Bundle);
  const entries = found.map((b) => ({
    b,
    entry: indexEntry(b, order.includes(b.bill.id) ? CURATED_PROVENANCE : watcherProvenance(b, watched)),
  }));
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  entries.sort(
    (x, y) =>
      rank(x.entry.id) - rank(y.entry.id) ||
      (y.entry.addedOn ?? "").localeCompare(x.entry.addedOn ?? "") ||
      (y.entry.latestActionOn ?? "").localeCompare(x.entry.latestActionOn ?? "") ||
      x.entry.id.localeCompare(y.entry.id),
  );
  const cut = entries.filter((e) => e.entry.origin === "watcher").slice(keep);
  for (const { entry } of cut) for (const f of bundleFiles(entry.id)) await rm(join(dir, f), { force: true });
  const kept = entries.filter((e) => !cut.includes(e));
  const index = BundleIndex.parse({
    generatedAt: new Date().toISOString(),
    bills: kept.map((e) => e.entry),
    watch: await watchPicks(new Map(kept.map((e) => [e.b.bill.id, e.b])), watched),
  });
  await mkdir(dir, { recursive: true });
  await Bun.write(join(dir, "index.json"), `${JSON.stringify(index, null, 1)}\n`);
  return index;
}
