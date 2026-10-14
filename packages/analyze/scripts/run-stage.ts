import { stages as analyze } from "@antibody/analyze";
import { parseBillId, type Stage } from "@antibody/core";
import { stages as news } from "@antibody/ingest-news";

const [name, bill] = Bun.argv.slice(2);
const stage = [...news, ...analyze].find((s: Stage) => s.name === name);
if (!stage) throw new Error(`no stage ${name}`);
await stage.run({
  bill: bill ? parseBillId(bill) : null,
  refresh: Bun.argv.includes("--refresh"),
  log: (m) => console.log(`  ${name}: ${m}`),
  signal: new AbortController().signal,
});
