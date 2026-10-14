#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { parseBillId } from "@antibody/core";
import { ingestBill } from "./ingest.ts";

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: { refresh: { type: "boolean", default: false }, "no-llm": { type: "boolean", default: false } },
});
if (!positionals[0]) throw new Error("usage: bun packages/ingest-bills/src/run.ts <bill> [--refresh] [--no-llm]");

const t0 = performance.now();
const { rows, skipped } = await ingestBill(parseBillId(positionals[0]), {
  refresh: values.refresh,
  llm: !values["no-llm"],
  log: (m) => console.error(m),
});
const counts = Object.fromEntries(Object.entries(rows).map(([t, r]) => [t, r.length]));
console.error(JSON.stringify({ seconds: Math.round((performance.now() - t0) / 100) / 10, counts, skipped }));
