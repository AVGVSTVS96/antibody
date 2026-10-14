import { join } from "node:path";
import { heavy, paths } from "@antibody/core/node";

/** The two election cycles that matter for a Congress: the one that seated it and the one it serves in (119th → 2024, 2026). */
export const cyclesFor = (congress: number) => [1786 + 2 * congress, 1788 + 2 * congress];

/** FEC bulk file names: pas2 (committee → candidate), cm (committees), cn (candidates), ccl (linkages), indiv (itemized). */
export type BulkFile = "pas2" | "cm" | "cn" | "ccl" | "indiv";
const MEMBER: Record<BulkFile, string> = {
  pas2: "itpas2.txt",
  cm: "cm.txt",
  cn: "cn.txt",
  ccl: "ccl.txt",
  indiv: "itcont.txt",
};

export const bulkUrl = (file: BulkFile, cycle: number) =>
  `https://www.fec.gov/files/bulk-downloads/${cycle}/${file}${String(cycle).slice(2)}.zip`;

/** Downloads a bulk zip into data/fec/ once (resumable; indiv files are 2-6 GB). */
export async function bulkZip(file: BulkFile, cycle: number, refresh = false): Promise<string> {
  const zip = join(paths.raw("fec"), `${file}${String(cycle).slice(2)}.zip`);
  if (!refresh && (await Bun.file(zip).exists())) return zip;
  const part = `${zip}.part`;
  await heavy(["curl", "-sSfL", "-C", "-", "-o", part, bulkUrl(file, cycle)], { memoryMax: "1G" });
  await heavy(["mv", part, zip], { memoryMax: "1G" });
  return zip;
}

/**
 * Streams a bulk file straight out of its zip as `|`-split fields, never holding the file in memory. With `firstField`,
 * a line is decoded only when its first field is in the set: indiv files are 30-70M lines, and we keep a few million.
 */
export async function* rows(file: BulkFile, cycle: number, firstField?: Set<string>): AsyncGenerator<string[]> {
  const zip = await bulkZip(file, cycle);
  const proc = Bun.spawn(["unzip", "-p", zip, MEMBER[file]], { stdout: "pipe", stderr: "inherit" });
  const decoder = new TextDecoder();
  let carry = new Uint8Array(0);
  for await (const piece of proc.stdout) {
    const chunk = carry.length ? Buffer.concat([carry, piece]) : piece;
    let start = 0;
    for (let nl = chunk.indexOf(NL, start); nl !== -1; start = nl + 1, nl = chunk.indexOf(NL, start)) {
      if (firstField) {
        const bar = chunk.indexOf(BAR, start);
        if (bar === -1 || bar > nl || !firstField.has(String.fromCharCode(...chunk.subarray(start, bar)))) continue;
      }
      const end = chunk[nl - 1] === CR ? nl - 1 : nl;
      yield decoder.decode(chunk.subarray(start, end)).split("|");
    }
    carry = chunk.slice(start);
  }
  if (carry.length) yield decoder.decode(carry).split("|");
  if ((await proc.exited) !== 0) throw new Error(`unzip failed on ${zip}`);
}

const [NL, CR, BAR] = [10, 13, 124];

/** FEC writes dates as MMDDYYYY. */
export function fecDate(s: string | undefined): string | null {
  const m = s?.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${m[1]}-${m[2]}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export const imageUrl = (imageNum: string) => `https://docquery.fec.gov/cgi-bin/fecimg/?${imageNum}`;
