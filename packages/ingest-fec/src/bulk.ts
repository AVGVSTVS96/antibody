import { join } from "node:path";
import { heavy, paths } from "@antibody/core/node";

export const cyclesFor = (congress: number) => {
  const seatedBy = 1786 + 2 * congress;

  return [seatedBy, seatedBy + 2];
};

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

export async function bulkZip(file: BulkFile, cycle: number, dir = paths.raw("fec"), refresh = false): Promise<string> {
  const zip = join(dir, `${file}${String(cycle).slice(2)}.zip`);

  if (!refresh && (await Bun.file(zip).exists())) {
    return zip;
  }

  const part = `${zip}.part`;
  await heavy(["curl", "-sSfL", "-C", "-", "-o", part, bulkUrl(file, cycle)], { memoryMax: "1G" });
  await heavy(["mv", part, zip], { memoryMax: "1G" });

  return zip;
}

export async function* rows(
  file: BulkFile,
  cycle: number,
  { firstField, dir }: { firstField?: Set<string>; dir?: string | undefined } = {},
): AsyncGenerator<string[]> {
  const zip = await bulkZip(file, cycle, dir);
  const proc = Bun.spawn(["unzip", "-p", zip, MEMBER[file]], { stdout: "pipe", stderr: "inherit" });
  const decoder = new TextDecoder();
  let carry = new Uint8Array(0);

  for await (const piece of proc.stdout) {
    const chunk = carry.length ? Buffer.concat([carry, piece]) : piece;
    let start = 0;

    for (let nl = chunk.indexOf(NL, start); nl !== -1; start = nl + 1, nl = chunk.indexOf(NL, start)) {
      if (firstField) {
        const bar = chunk.indexOf(BAR, start);

        if (bar === -1 || bar > nl || !firstField.has(String.fromCodePoint(...chunk.subarray(start, bar)))) {
          continue;
        }
      }

      const end = chunk[nl - 1] === CR ? nl - 1 : nl;
      yield decoder.decode(chunk.subarray(start, end)).split("|");
    }

    carry = chunk.slice(start);
  }

  if (carry.length) {
    yield decoder.decode(carry).split("|");
  }

  if ((await proc.exited) !== 0) {
    throw new Error(`unzip failed on ${zip}`);
  }
}

const [NL, CR, BAR] = [10, 13, 124];

export function fecDate(mmddyyyy: string | undefined): string | null {
  const m = mmddyyyy?.match(/^(\d{2})(\d{2})(\d{4})$/u);

  if (!m) {
    return null;
  }

  const iso = `${m[3]}-${m[1]}-${m[2]}`;

  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export function column(fields: string[], index: number): string {
  const value = fields[index];

  if (value === undefined) {
    throw new RangeError(`FEC bulk line has ${fields.length} columns, column ${index} missing: ${fields.join("|")}`);
  }

  return value;
}

export const blankToNull = (value: string | undefined) => (value === undefined || value === "" ? null : value);

export const imageUrl = (imageNum: string) => `https://docquery.fec.gov/cgi-bin/fecimg/?${imageNum}`;
