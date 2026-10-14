import { join } from "node:path";
import { paths } from "@antibody/core/node";
import { cached, NotFound } from "./fetch.ts";

const DIR = join(paths.raw("bills"), "crec");

export interface AmendmentText {
  /** The Congressional Record granule page (HTML) the text was read from. */
  url: string;
  /** "171 Cong. Rec. S4133" */
  citation: string | null;
  text: string;
}

async function mods(date: string): Promise<string | null> {
  try {
    return await cached(`https://www.govinfo.gov/metadata/pkg/CREC-${date}/mods.xml`, `mods-${date}.xml`, false, DIR);
  } catch (e) {
    if (e instanceof NotFound) return null;
    throw e;
  }
}

const unhtml = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");

function granuleAt(xml: string, at: number): string | null {
  return [...xml.slice(Math.max(0, at - 2000), at).matchAll(/ID="id-(CREC-[^"]+)"/g)].at(-1)?.[1] ?? null;
}

/** The amendment's own text from a Record page: from "SA <n>." to the end, without the closing rule. */
export function amendmentFrom(html: string, number: string): string {
  const body = unhtml(html.match(/<pre>([\s\S]*)<\/pre>/)?.[1] ?? html);
  const start = body.search(new RegExp(`\\bSA ${number}\\.`));
  if (start < 0) return body;
  const rest = body.slice(start);
  const next = rest.slice(1).search(/\n {1,4}SA \d+\. /);
  return (next < 0 ? rest : rest.slice(0, next + 1)).replace(/\n\s*_{6,}\s*$/, "");
}

async function read(date: string, granule: string, xml: string, at: number, number: string): Promise<AmendmentText> {
  const url = `https://www.govinfo.gov/content/pkg/CREC-${date}/html/${granule}.htm`;
  const text = amendmentFrom(await cached(url, `${granule}.htm`, false, DIR), number);
  const citation = xml.slice(at, at + 20000).match(/<identifier type="preferred citation">([^<]+)</)?.[1] ?? null;
  return { url, citation, text };
}

interface PageRef {
  date: string;
  page: string;
  /** The text as modified on the floor: what was actually agreed to. */
  modified: boolean;
}

async function byTitle(date: string, number: string): Promise<AmendmentText | null> {
  const xml = await mods(date);
  const at = xml?.indexOf(`<title>Text of Senate Amendment ${number}</title>`) ?? -1;
  const granule = xml && at >= 0 ? granuleAt(xml, at) : null;
  return xml && granule ? read(date, granule, xml, at, number) : null;
}

/** The widest granule starting at the cited page (a debate granule holds a substitute printed in full). */
async function byPage({ date, page }: PageRef, number: string): Promise<AmendmentText | null> {
  const xml = await mods(date);
  if (!xml) return null;
  const pageNum = (p: string) => Number(p.replace(/\D/g, ""));
  const hits = [...xml.matchAll(new RegExp(`<start>${page}</start>\\s*<end>([SH]\\d+)</end>`, "g"))];
  const widest = hits.sort((a, b) => pageNum(b[1]!) - pageNum(a[1]!))[0];
  if (!widest) return null;
  const open = xml.lastIndexOf('<relatedItem type="constituent"', widest.index);
  const granule = granuleAt(xml, open + 200);
  return granule ? read(date, granule, xml, open, number) : null;
}

/**
 * The text of a Senate amendment as printed in the Congressional Record, preferring what was agreed to: a substitute
 * modified on the floor is printed inside the debate at the page its action cites ("text as modified: CR S4070-4144");
 * otherwise GovInfo's own granule "Text of Senate Amendment <n>" from the day it was submitted; otherwise a cited page.
 */
export async function senateAmendmentText(
  number: string,
  dates: string[],
  refs: PageRef[] = [],
): Promise<AmendmentText | null> {
  for (const ref of refs.filter((r) => r.modified)) {
    const hit = await byPage(ref, number);
    if (hit) return hit;
  }
  for (const date of [...new Set(dates)].sort()) {
    const hit = await byTitle(date, number);
    if (hit) return hit;
  }
  for (const ref of refs.filter((r) => !r.modified)) {
    const hit = await byPage(ref, number);
    if (hit) return hit;
  }
  return null;
}

/** Pages an amendment's actions cite for its text: "(text: CR S4200)", "text as modified: CR S4070-4144". */
export function textPages(actions: { date: string; text: string }[]): PageRef[] {
  return actions.flatMap((a) =>
    [...a.text.matchAll(/text( as modified)?: CR ([SH]\d+)/g)].map((m) => ({
      date: a.date,
      page: m[2]!,
      modified: !!m[1],
    })),
  );
}
