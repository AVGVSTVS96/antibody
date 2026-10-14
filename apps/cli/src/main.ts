#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { type BillId, parseBillId, type StageContext } from "@antibody/core";
import { readRows } from "@antibody/core/node";
import { order, type Registered, register } from "./plan.ts";
import { PACKAGES } from "./registry.ts";

const HELP = `antibody — x-ray a US federal bill

  antibody xray <bill> [--refresh]   run every stage for one bill and build its bundle
  antibody run <stage> [<bill>]      run one stage (and what it needs)
  antibody watch                     the daily watcher
  antibody stages                    list stages by package

<bill> is anything like S.1582, "H.R. 1 (119th)", 119-s-1582 or a congress.gov URL.`;

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: { refresh: { type: "boolean", default: false }, only: { type: "boolean", default: false } },
});
const [command, arg, arg2] = positionals;
const all = register(PACKAGES);

async function run(stages: Registered[], bill: BillId | null) {
  const controller = new AbortController();
  process.on("SIGINT", () => controller.abort());
  for (const s of stages) {
    if (s.scope === "global" && !values.refresh) {
      const filled = await Promise.all(s.writes.map(async (t) => (await readRows(t)).length > 0));
      if (filled.every(Boolean) && s.writes.length) {
        console.log(`· ${s.name} (global, cached)`);
        continue;
      }
    }
    if (s.scope === "bill" && !bill) throw new Error(`stage "${s.name}" needs a bill`);
    const ctx: StageContext = {
      bill: s.scope === "bill" ? bill : null,
      refresh: values.refresh,
      log: (m) => console.log(`  ${s.name}: ${m}`),
      signal: controller.signal,
    };
    const t0 = performance.now();
    console.log(`▸ ${s.name}`);
    await s.run(ctx);
    console.log(`✓ ${s.name} ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  }
}

switch (command) {
  case "xray": {
    if (!arg) throw new Error("usage: antibody xray <bill>");
    const bill = parseBillId(arg);
    const targets = [...all.values()].filter((s) => s.scope === "bill").map((s) => s.name);
    if (!targets.length) console.log("no bill stages registered yet");
    await run(order(all, targets), bill);
    break;
  }
  case "run": {
    if (!arg) throw new Error("usage: antibody run <stage> [<bill>]");
    const stages = values.only ? [all.get(arg)!].filter(Boolean) : order(all, [arg]);
    await run(stages, arg2 ? parseBillId(arg2) : null);
    break;
  }
  case "watch":
    await run(order(all, ["watch"]), null);
    break;
  case "stages":
    for (const [pkg, stages] of Object.entries(PACKAGES))
      console.log(
        `${pkg}\n${stages.map((s) => `  ${s.name} (${s.scope}) → ${s.writes.join(", ")}`).join("\n") || "  —"}`,
      );
    break;
  default:
    console.log(HELP);
}
