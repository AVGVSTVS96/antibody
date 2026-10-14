import { join } from "node:path";
import { paths } from "@antibody/core/node";
import { pool } from "../src/http.ts";

/**
 * Independent check of the House e-filed parser: counts trade rows in poppler's `pdftotext -layout` output with a
 * separate regex (type letter, then two dates) and compares per document with the parsed rows.
 */
const root = paths.raw("trades");
const row = /\s(P|S|E|S \(partial\))\s+\d{2}\/\d{2}\/\d{4}\s+\d{2}\/\d{2}\/\d{4}/gi;
const parsed = new Map<string, { year: string; n: number }>();
for (const line of (await Bun.file(join(root, "house-parsed.jsonl")).text()).split("\n")) {
  if (!line) continue;
  const d = JSON.parse(line);
  if (/^[89]/.test(d.doc_id)) continue;
  parsed.set(d.doc_id, { year: d.year, n: d.trades.length });
}
const mismatch: [string, number, number][] = [];
let poppler = 0;
let ours = 0;
await pool([...parsed], 8, async ([docId, { year, n }]) => {
  const proc = Bun.spawn(["pdftotext", "-layout", join(root, "house", year, `${docId}.pdf`), "-"], { stdout: "pipe" });
  const count = ((await new Response(proc.stdout).text()).match(row) ?? []).length;
  poppler += count;
  ours += n;
  if (count !== n) mismatch.push([`${year}/${docId}`, count, n]);
});
console.log(JSON.stringify({ docs: parsed.size, poppler, parsed: ours, mismatched: mismatch.length, sample: mismatch.slice(0, 15) }, null, 1));
