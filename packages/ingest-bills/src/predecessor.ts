import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { type BillId, billDisplay, billRef, billstatusUrl } from "@antibody/core";
import { heavy, paths } from "@antibody/core/node";
import { type BillStatus, parseBillStatus } from "./billstatus.ts";
import { cached } from "./fetch.ts";
import { match } from "./match.ts";
import type { Sec } from "./sections.ts";
import { textVersions, type VersionRef } from "./versions.ts";

const INDEX = join(paths.raw("bills"), "index");
const INTRODUCED = new Set(["ih", "is"]);

/** "GENIUS Act of 2025" and "GENIUS Act" are one name. */
export const titleKey = (t: string) =>
  t
    .toLowerCase()
    .replace(/\s+of \d{4}$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

type TitleIndex = Record<string, { number: number; introducedOn: string | null }[]>;

/**
 * Short title → bills, for one Congress and bill type, built once from GovInfo's BILLSTATUS bulk zip
 * (13 MB for Senate bills, 33 MB for House bills) and cached as data/bills/index/<congress>-<type>.json.
 */
async function titleIndex(congress: number, type: string, refresh: boolean): Promise<TitleIndex> {
  const file = join(INDEX, `${congress}-${type}.json`);
  if (!refresh && (await Bun.file(file).exists())) return Bun.file(file).json();
  await mkdir(INDEX, { recursive: true });
  const zip = join(INDEX, `BILLSTATUS-${congress}-${type}.zip`);
  await heavy([
    "curl",
    "-fsSL",
    "-o",
    zip,
    `https://www.govinfo.gov/bulkdata/BILLSTATUS/${congress}/${type}/BILLSTATUS-${congress}-${type}.zip`,
  ]);
  const dir = join(INDEX, `${congress}-${type}`);
  await heavy(["unzip", "-o", "-q", zip, "-d", dir], { memoryMax: "1G" });
  const index: TitleIndex = {};
  for (const name of await readdir(dir, { recursive: true })) {
    if (!name.endsWith(".xml")) continue;
    const doc = await Bun.file(join(dir, name)).text();
    const number = Number(doc.match(/<bill>[\s\S]*?<number>(\d+)<\/number>/)?.[1]);
    const introducedOn = doc.match(/<introducedDate>([\d-]+)<\/introducedDate>/)?.[1] ?? null;
    const titles = [...doc.matchAll(/<titleType>Short Title[^<]*<\/titleType>[\s\S]*?<title>([^<]+)<\/title>/g)];
    for (const key of new Set(titles.map((m) => titleKey(m[1]!))))
      index[key] = [...(index[key] ?? []), { number, introducedOn }];
  }
  await Bun.write(file, JSON.stringify(index));
  await rm(dir, { recursive: true });
  await rm(zip);
  return index;
}

export interface Predecessor {
  bill: BillId;
  version: VersionRef;
  rule: string;
}

/**
 * An original bill reported straight from committee (no introduced text) is often the rewrite of an earlier bill with
 * the same short title: S.1582 (GENIUS) was drafted from S.394. That earlier text is shown as a stage before the bill,
 * labeled inference: same short title, introduced earlier in the same Congress, and most of its sections carry over.
 */
export async function findPredecessor(
  status: BillStatus,
  first: { ref: VersionRef; secs: Sec[] },
  load: (ref: VersionRef) => Promise<Sec[]>,
  refresh: boolean,
): Promise<Predecessor | null> {
  if (INTRODUCED.has(first.ref.code) || !first.ref.date) return null;
  const { congress, type, number } = billRef(status.id);
  const names = new Set(
    [status.shortTitle, ...[status.title].filter((t) => t.length < 80)].filter((t): t is string => !!t).map(titleKey),
  );
  const index = await titleIndex(congress, type, refresh);
  const candidates = [...names]
    .flatMap((n) => index[n] ?? [])
    .filter((c) => c.number !== number && c.introducedOn && c.introducedOn < first.ref.date!);

  for (const c of candidates) {
    const id = `${congress}-${type}-${c.number}` as BillId;
    const other = parseBillStatus(
      await cached(billstatusUrl(id), `BILLSTATUS-${congress}${type}${c.number}.xml`, refresh),
      id,
    );
    const ref = textVersions(other)
      .filter((v) => v.date && v.date < first.ref.date! && v.code !== "plaw")
      .at(-1);
    if (!ref) continue;
    const secs = await load(ref);
    const pairs = match(secs, first.secs);
    const byText = [...pairs.values()].filter((p) => ["identical", "xml-id", "fuzzy"].includes(p.method)).length;
    if (!secs.length || pairs.size / secs.length < 0.6 || byText / secs.length < 0.4) continue;
    const name = other.shortTitle ?? other.title;
    return {
      bill: id,
      version: {
        ...ref,
        code: `${type}${c.number}-${ref.code}`,
        name: `${billDisplay(id)} ${ref.name} (predecessor bill)`,
      },
      rule: `predecessor-bill: ${billDisplay(id)} ("${name}") has the same short title, was introduced ${other.introducedOn} in the same Congress, and ${pairs.size} of its ${secs.length} sections carry into ${billDisplay(status.id)}'s first text (${byText} by shared wording)`,
    };
  }
  return null;
}
