import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Bundle, BundleIndex, WatchPick, billDisplay, billStats, parseBillId } from "@antibody/core";
import type { Row } from "@antibody/core";
import { paths, readRows } from "@antibody/core/node";

const STAMP = /"generatedAt":"[^"]*"/u;

const claimsFile = (id: string) => `${id}.claims.json`;

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

      if (old?.replace(STAMP, "") !== json.replace(STAMP, "")) {
        await Bun.write(file, json);
      }
    }

    files.push(join(dir, `${bundle.bill.id}.json`));
  }

  return files;
}

export function latestActionOn(b: Bundle): string | null {
  const dates = [
    b.bill.lawOn,
    ...b.votes.map((v) => v.date),
    ...b.versions.map((v) => v.date),
    ...b.amendments.map((a) => a.latestActionOn),
  ].filter((d): d is string => d !== null && d !== undefined && d !== "");

  return dates.toSorted().at(-1) ?? null;
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

const detailText = WatchPick.shape.reason.catch(null);
const detailParty = WatchPick.shape.sponsorParty.catch(null);

function watchPicks(bundles: Map<string, Bundle>, events: Row<"watch_events">[]): BundleIndex["watch"] {
  const hot = events.filter((e) => e.kind === "hot");

  const latest = hot
    .map((e) => e.seen_at)
    .toSorted()
    .at(-1);

  return hot
    .filter((e) => e.seen_at === latest)
    .toSorted((a, b) => Number(b.detail.score ?? 0) - Number(a.detail.score ?? 0))
    .map((e) => {
      const b = bundles.get(e.bill_id);
      const display = billDisplay(parseBillId(e.bill_id));

      return {
        billId: e.bill_id,
        display: b?.bill.display ?? display,
        title: b?.bill.shortTitle ?? b?.bill.title ?? detailText.parse(e.detail.title) ?? display,
        kind: e.kind,
        seenAt: e.seen_at,
        url: e.url,
        reason: detailText.parse(e.detail.reason),
        sponsorParty: b ? sponsorParty(b) : detailParty.parse(e.detail.sponsorParty),
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

  return `From the daily watch, or its sweep that scores every bill of a Congress on its whole record; not hand-checked. Sponsor, law status and company matches come straight from the automated run${thin.map((t) => `; ${t}`).join("")}.`;
}

function watcherProvenance(b: Bundle, events: Row<"watch_events">[]): Provenance {
  const first = events
    .flatMap((e) => (e.bill_id === b.bill.id && e.kind === "hot" ? [e.seen_at.slice(0, 10)] : []))
    .toSorted()[0];

  return { origin: "watcher", note: watcherNote(b), addedOn: first ?? b.generatedAt.slice(0, 10) };
}

export async function writeIndex(
  dir = paths.published,
  order: string[] = [],
  events?: Row<"watch_events">[],
): Promise<BundleIndex> {
  const watched = events ?? (await readRows("watch_events"));

  const files = (await readdir(dir).catch((): string[] => [])).filter(
    (f) => f.endsWith(".json") && f !== "index.json" && !f.endsWith(".claims.json"),
  );

  const found: Bundle[] = [];

  for (const f of files) {
    found.push(Bundle.parse(await Bun.file(join(dir, f)).json()));
  }

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

  const index = BundleIndex.parse({
    generatedAt: new Date().toISOString(),
    bills: entries.map((e) => e.entry),
    watch: watchPicks(new Map(entries.map((e) => [e.b.bill.id, e.b])), watched),
  });

  await mkdir(dir, { recursive: true });
  await Bun.write(join(dir, "index.json"), `${JSON.stringify(index, null, 1)}\n`);

  return index;
}
