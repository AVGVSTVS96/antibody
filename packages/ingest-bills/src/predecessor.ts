import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { billDisplay, billId, billRef, billstatusUrl } from "@antibody/core";
import type { BillId } from "@antibody/core";
import { heavy, paths } from "@antibody/core/node";
import { parseBillStatus } from "./billstatus.ts";
import type { BillStatus } from "./billstatus.ts";
import { cached } from "./fetch.ts";
import { match } from "./match.ts";
import type { Sec } from "./sections.ts";
import { textVersions } from "./versions.ts";
import type { VersionRef } from "./versions.ts";

const INDEX = join(paths.raw("bills"), "index");
const INTRODUCED = new Set(["ih", "is"]);

export const titleKey = (t: string) =>
  t
    .toLowerCase()
    .replace(/\s+of \d{4}$/u, "")
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim();

type TitleIndex = Record<string, { number: number; introducedOn: string | null }[]>;

const isTitleIndex = (value: unknown): value is TitleIndex =>
  typeof value === "object" && value !== null && Object.values(value).every((bills) => Array.isArray(bills));

async function titleIndex(congress: number, type: string, refresh: boolean): Promise<TitleIndex> {
  const file = join(INDEX, `${congress}-${type}.json`);

  if (!refresh && (await Bun.file(file).exists())) {
    const saved: unknown = await Bun.file(file).json();

    if (!isTitleIndex(saved)) {
      throw new Error(`${file} is not a title index; rerun with --refresh`);
    }

    return saved;
  }

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
    if (!name.endsWith(".xml")) {
      continue;
    }

    const doc = await Bun.file(join(dir, name)).text();
    const number = Number(/<bill>[\s\S]*?<number>(\d+)<\/number>/u.exec(doc)?.[1]);
    const introducedOn = /<introducedDate>([\d-]+)<\/introducedDate>/u.exec(doc)?.[1] ?? null;
    const titles = [...doc.matchAll(/<titleType>Short Title[^<]*<\/titleType>[\s\S]*?<title>([^<]+)<\/title>/gu)];

    for (const key of new Set(titles.map(([, title = ""]) => titleKey(title)))) {
      index[key] = [...(index[key] ?? []), { number, introducedOn }];
    }
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

export async function findPredecessor(
  status: BillStatus,
  first: { ref: VersionRef; secs: Sec[] },
  load: (ref: VersionRef) => Promise<Sec[]>,
  refresh: boolean,
): Promise<Predecessor | null> {
  const firstDate = first.ref.date;

  if (INTRODUCED.has(first.ref.code) || firstDate === null || firstDate === "") {
    return null;
  }

  const { congress, type, number } = billRef(status.id);

  const names = new Set(
    [status.shortTitle, ...[status.title].filter((t) => t.length < 80)].flatMap((t) =>
      t === null || t === "" ? [] : [titleKey(t)],
    ),
  );

  const index = await titleIndex(congress, type, refresh);

  const candidates = [...names]
    .flatMap((n) => index[n] ?? [])
    .filter(
      (c) => c.number !== number && c.introducedOn !== null && c.introducedOn !== "" && c.introducedOn < firstDate,
    );

  for (const c of candidates) {
    const id = billId({ congress, type, number: c.number });

    const other = parseBillStatus(
      await cached(billstatusUrl(id), `BILLSTATUS-${congress}${type}${c.number}.xml`, refresh),
      id,
    );

    const ref = textVersions(other).findLast(
      (v) => v.date !== null && v.date !== "" && v.date < firstDate && v.code !== "plaw",
    );

    if (ref === undefined) {
      continue;
    }

    const secs = await load(ref);
    const pairs = match(secs, first.secs);
    const byText = [...pairs.values()].filter((p) => ["identical", "xml-id", "fuzzy"].includes(p.method)).length;

    if (secs.length === 0 || pairs.size / secs.length < 0.6 || byText / secs.length < 0.4) {
      continue;
    }

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
