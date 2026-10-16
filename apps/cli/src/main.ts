#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { type BillId, parseBillId, type StageContext } from "@antibody/core";
import { paths, readRows } from "@antibody/core/node";
import { buildBundle, CURATED, type Db, loadTables, openDb, writeBundle, writeIndex } from "@antibody/store";
import { order, type Registered, register } from "./plan.ts";
import { PACKAGES } from "./registry.ts";

const HELP = `antibody — x-ray a US federal bill

  antibody xray <bill> [--refresh] [--publish]   run every stage for one bill, then build its bundle
  antibody bundle <bill>... [--publish]          build bundles from the tables as they are (no stages)
  antibody build [--refresh] [--no-stages]       x-ray the curated bills and publish them + the index for the site
  antibody run <stage> [<bill>] [--only]         run one stage (and what it needs)
  antibody watch [--no-deploy]                   the daily watcher: digest, x-ray, publish to the site, deploy
  antibody stages                                list stages by package

<bill> is anything like S.1582, "H.R. 1 (119th)", 119-s-1582 or a congress.gov URL.
--publish copies bundles to apps/web/public/bundles/ and rewrites its index.json.`;

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    refresh: { type: "boolean", default: false },
    only: { type: "boolean", default: false },
    publish: { type: "boolean", default: false },
    "no-stages": { type: "boolean", default: false },
    "no-deploy": { type: "boolean", default: false },
  },
});
const [command, ...args] = positionals;
const all = register(PACKAGES);
const controller = new AbortController();
process.on("SIGINT", () => controller.abort());

/** Global stages that already ran in this process; `build` refreshes them once, not once per bill. */
const ranGlobal = new Set<string>();

async function run(stages: Registered[], bill: BillId | null, targets: string[] = []) {
  for (const s of stages) {
    if (s.scope === "global") {
      if (ranGlobal.has(s.name)) continue;
      ranGlobal.add(s.name);
      if (!values.refresh && !targets.includes(s.name) && s.writes.length) {
        const filled = await Promise.all(s.writes.map(async (t) => (await readRows(t)).length > 0));
        if (filled.every(Boolean)) {
          console.log(`· ${s.name} (global, cached)`);
          continue;
        }
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
    console.log(`▸ ${s.name}${bill && s.scope === "bill" ? ` ${bill}` : ""}`);
    await s.run(ctx);
    console.log(`✓ ${s.name} ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  }
}

const billStages = () =>
  order(
    all,
    [...all.values()].filter((s) => s.scope === "bill").map((s) => s.name),
  );

/** Opens the shared DuckDB file, or an in-memory one when another process holds the file's lock. */
async function database(): Promise<Db> {
  try {
    return await openDb();
  } catch (e) {
    console.log(`· ${paths.db} is busy (${(e as Error).message.split("\n")[0]}); loading into memory instead`);
    return openDb(":memory:");
  }
}

/** Loads every table once, then builds, checks and writes each bill's bundle. Returns the ids that failed. */
async function bundles(ids: BillId[], publish: boolean): Promise<BillId[]> {
  const db = await database();
  const counts = await loadTables(db);
  const loaded = Object.entries(counts).filter(([, n]) => n);
  console.log(`· loaded ${loaded.map(([t, n]) => `${t} ${n}`).join(", ") || "no rows"}`);
  const failed: BillId[] = [];
  for (const id of ids) {
    try {
      const { bundle, warnings } = await buildBundle(db, id);
      const [file] = await writeBundle(bundle, { publish });
      const size = (Bun.file(file!).size / 1024).toFixed(0);
      console.log(
        `✓ bundle ${id}: ${bundle.sections.length} sections, ${bundle.nodes.length} nodes, ${bundle.edges.length} edges, ${Object.keys(bundle.claims).length} claims, ${bundle.gaps.length} gaps, ${size} KB`,
      );
      if (warnings.length) {
        const log = `${paths.bundles}/${id}.warnings.txt`;
        await Bun.write(log, `${warnings.join("\n")}\n`);
        console.log(`  ${warnings.length} rows left out (${log}), e.g. ${warnings.slice(0, 3).join("; ")}`);
      }
    } catch (e) {
      failed.push(id);
      console.log(`✗ bundle ${id}: ${(e as Error).message}`);
    }
  }
  if (publish) {
    const index = await writeIndex(
      paths.published,
      CURATED.map((p) => p.id),
    );
    console.log(`✓ index: ${index.bills.length} bills in ${paths.published}/index.json`);
  }
  return failed;
}

/** Runs the bill stages for each bill; a failing stage stops that bill only. Returns the ids that failed. */
async function xray(ids: BillId[]): Promise<BillId[]> {
  const failed: BillId[] = [];
  const stages = billStages();
  if (!stages.length) console.log("· no bill stages registered yet");
  for (const id of ids) {
    try {
      await run(stages, id);
    } catch (e) {
      if (controller.signal.aborted) throw e;
      failed.push(id);
      console.log(`✗ ${id}: ${(e as Error).stack ?? e}`);
    }
  }
  return failed;
}

function finish(failed: BillId[]) {
  if (!failed.length) return;
  console.log(`\n${failed.length} failed: ${failed.join(", ")}`);
  process.exitCode = 1;
}

switch (command) {
  case "xray": {
    if (!args[0]) throw new Error("usage: antibody xray <bill>");
    const bill = parseBillId(args[0]);
    const failed = await xray([bill]);
    finish([...new Set([...failed, ...(await bundles([bill], values.publish))])]);
    break;
  }
  case "bundle": {
    if (!args.length) throw new Error("usage: antibody bundle <bill>...");
    finish(
      await bundles(
        args.map((a) => parseBillId(a)),
        values.publish,
      ),
    );
    break;
  }
  case "build": {
    const ids = CURATED.map((p) => p.id);
    const failed = values["no-stages"] ? [] : await xray(ids);
    finish([...new Set([...failed, ...(await bundles(ids, true))])]);
    break;
  }
  case "run": {
    if (!args[0]) throw new Error("usage: antibody run <stage> [<bill>]");
    const stages = values.only ? [all.get(args[0])!].filter(Boolean) : order(all, [args[0]]);
    await run(stages, args[1] ? parseBillId(args[1]) : null, [args[0]]);
    break;
  }
  case "watch":
    if (values["no-deploy"]) process.env.ANTIBODY_WATCH_DEPLOY = "0";
    await run(order(all, ["watch"]), null, ["watch"]);
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
