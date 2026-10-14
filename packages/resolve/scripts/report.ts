/**
 * Coverage of the last dev run: per source, how many distinct names (and records) resolved, by method.
 *   bun packages/resolve/scripts/report.ts
 */
import { join } from "node:path";
import { paths } from "@antibody/core/node";
import type { Resolved } from "../src/resolve.ts";

const outcomes = (await Bun.file(
  join(paths.raw("entities"), "resolve", "dev-outcomes.json"),
).json()) as Resolved["outcomes"];
const methods = ["ticker", "name_exact", "fuzzy", "llm_same", "llm_subsidiary", "llm_parent"];
console.log(`| source | distinct names | resolved | ${methods.join(" | ")} | records resolved |`);
console.log(`|${"---|".repeat(methods.length + 4)}`);
for (const source of ["client", "pac", "trade"]) {
  const rows = outcomes.filter((o) => o.mention.source === source);
  const hit = rows.filter((o) => o.match);
  const by = (m: string) => hit.filter((o) => o.match!.method === m).length;
  const records = (xs: typeof rows) => xs.reduce((s, o) => s + o.count, 0);
  const pct = (a: number, b: number) => `${a} (${Math.round((100 * a) / Math.max(b, 1))}%)`;
  console.log(
    `| ${source} | ${rows.length} | ${pct(hit.length, rows.length)} | ${methods.map(by).join(" | ")} | ${pct(records(hit), records(rows))} |`,
  );
}
