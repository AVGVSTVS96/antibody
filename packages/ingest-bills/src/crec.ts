import { join } from "node:path";
import { must } from "@antibody/core";
import { paths } from "@antibody/core/node";
import { cached, NotFoundError } from "./fetch.ts";

const DIR = join(paths.raw("bills"), "crec");

export interface AmendmentText {
  url: string;
  citation: string | null;
  text: string;
}

async function mods(date: string): Promise<string | null> {
  try {
    return await cached(`https://www.govinfo.gov/metadata/pkg/CREC-${date}/mods.xml`, `mods-${date}.xml`, false, DIR);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return null;
    }

    throw error;
  }
}

const unhtml = (s: string) =>
  s
    .replaceAll(/<[^>]+>/gu, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");

function granuleAt(xml: string, at: number): string | null {
  return [...xml.slice(Math.max(0, at - 2000), at).matchAll(/ID="id-(CREC-[^"]+)"/gu)].at(-1)?.[1] ?? null;
}

export function amendmentFrom(html: string, number: string): string {
  const body = unhtml(/<pre>([\s\S]*)<\/pre>/u.exec(html)?.[1] ?? html);
  const start = body.search(new RegExp(`\\bSA ${number}\\.`, "u"));

  if (start < 0) {
    return body;
  }

  const rest = body.slice(start);
  const next = rest.slice(1).search(/\n {1,4}SA \d+\. /u);

  return (next < 0 ? rest : rest.slice(0, next + 1)).replace(/\n\s*_{6,}\s*$/u, "");
}

async function read(date: string, granule: string, xml: string, at: number, number: string): Promise<AmendmentText> {
  const url = `https://www.govinfo.gov/content/pkg/CREC-${date}/html/${granule}.htm`;
  const text = amendmentFrom(await cached(url, `${granule}.htm`, false, DIR), number);
  const citation = /<identifier type="preferred citation">([^<]+)</u.exec(xml.slice(at, at + 20_000))?.[1] ?? null;

  return { url, citation, text };
}

interface PageRef {
  date: string;
  page: string;
  modified: boolean;
}

async function byTitle(date: string, number: string): Promise<AmendmentText | null> {
  const xml = await mods(date);
  const at = xml?.indexOf(`<title>Text of Senate Amendment ${number}</title>`) ?? -1;
  const granule = xml !== null && xml !== "" && at >= 0 ? granuleAt(xml, at) : null;

  return xml !== null && xml !== "" && granule !== null ? await read(date, granule, xml, at, number) : null;
}

const pageNum = (p: string | undefined) => Number(must(p, "an end page").replaceAll(/\D/gu, ""));

async function byPage({ date, page }: PageRef, number: string): Promise<AmendmentText | null> {
  const xml = await mods(date);

  if (xml === null || xml === "") {
    return null;
  }

  const hits = [...xml.matchAll(new RegExp(`<start>${page}</start>\\s*<end>([SH]\\d+)</end>`, "gu"))];
  const widest = hits.toSorted((a, b) => pageNum(b[1]) - pageNum(a[1]))[0];

  if (!widest) {
    return null;
  }

  const open = xml.lastIndexOf('<relatedItem type="constituent"', widest.index);
  const granule = granuleAt(xml, open + 200);

  return granule === null ? null : await read(date, granule, xml, open, number);
}

export async function senateAmendmentText(
  number: string,
  dates: string[],
  refs: PageRef[] = [],
): Promise<AmendmentText | null> {
  for (const ref of refs.filter((r) => r.modified)) {
    const hit = await byPage(ref, number);

    if (hit) {
      return hit;
    }
  }

  for (const date of [...new Set(dates)].toSorted()) {
    const hit = await byTitle(date, number);

    if (hit) {
      return hit;
    }
  }

  for (const ref of refs.filter((r) => !r.modified)) {
    const hit = await byPage(ref, number);

    if (hit) {
      return hit;
    }
  }

  return null;
}

export function textPages(actions: { date: string; text: string }[]): PageRef[] {
  return actions.flatMap((a) =>
    [...a.text.matchAll(/text(?<modified> as modified)?: CR (?<page>[SH]\d+)/gu)].map((m) => ({
      date: a.date,
      page: must(m.groups?.page, "a cited page"),
      modified: m.groups?.modified !== undefined,
    })),
  );
}
