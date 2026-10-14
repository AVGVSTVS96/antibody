/**
 * Runs the resolver over dev-mentions.json and writes the outcomes for measurement.
 *   bun packages/resolve/scripts/dev-run.ts [--no-llm]
 */
import { join } from "node:path";
import { paths } from "@antibody/core/node";
import { loadEdgar } from "../src/edgar.ts";
import { CompanyIndex, type Mention } from "../src/match.ts";
import { resolveAll } from "../src/resolve.ts";

const dir = join(paths.raw("entities"), "resolve");
const all = (await Bun.file(join(dir, "dev-mentions.json")).json()) as Mention[];
const sampleArg = process.argv.indexOf("--sample");
const mentions =
  sampleArg > 0 ? all.filter((_, i) => i % Math.ceil(all.length / +process.argv[sampleArg + 1]!) === 0) : all;
const t0 = performance.now();
const index = new CompanyIndex(await loadEdgar());
console.error(`index ${((performance.now() - t0) / 1000).toFixed(1)}s`);
const llm = !process.argv.includes("--no-llm");
const r = await resolveAll(mentions, index, { log: (m) => console.error(m), llm });
console.error(`resolved ${((performance.now() - t0) / 1000).toFixed(1)}s`, r.review);

const tally = new Map<string, number>();
for (const o of r.outcomes) {
  const k = `${o.mention.source} ${o.match?.method ?? o.outcome.kind}`;
  tally.set(k, (tally.get(k) ?? 0) + 1);
}
console.error(
  [...tally]
    .sort()
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n"),
);
await Bun.write(
  join(dir, llm ? `dev-outcomes${sampleArg > 0 ? "-sample" : ""}.json` : "dev-outcomes-nollm.json"),
  JSON.stringify(r.outcomes),
);
await Bun.write(join(dir, "dev-resolutions.jsonl"), r.rows.map((x) => JSON.stringify(x)).join("\n"));
