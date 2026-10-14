import { stages } from "@antibody/analyze";
import { parseBillId } from "@antibody/core";

const [name, bill] = Bun.argv.slice(2);
const s = stages.find((x) => x.name === name)!;
await s.run({
  bill: parseBillId(bill),
  refresh: false,
  log: (m) => console.log(`  ${name}: ${m}`),
  signal: new AbortController().signal,
});
