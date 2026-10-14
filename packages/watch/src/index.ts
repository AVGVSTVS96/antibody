import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import type { Stage } from "@antibody/core";
import { paths } from "@antibody/core/node";
import { digestJson, digestMarkdown, FLAGGED, pageUrl } from "./digest.ts";
import { recordEvents, watch } from "./watch.ts";

export { digestJson, digestMarkdown, reasons } from "./digest.ts";
export { RULE_TEXT, RULES_VERSION, score, subScores, WEIGHTS } from "./score.ts";
export { watch } from "./watch.ts";

/** Exit codes for a scheduler: 0 clean, 2 digest written but a source, lookup or x-ray failed (listed in it). */
export const EXIT_DEGRADED = 2;

async function write(file: string, body: string) {
  await Bun.write(`${file}.tmp`, body);
  await rename(`${file}.tmp`, file);
}

export const stages: Stage[] = [
  {
    name: "watch",
    scope: "global",
    needs: [],
    writes: ["watch_events"],
    async run(ctx) {
      const r = await watch(ctx.log, ctx.signal);
      const d = digestJson(r);
      const dir = paths.raw("watch");
      await mkdir(dir, { recursive: true });
      await write(join(dir, `${r.date}.json`), `${JSON.stringify(d, null, 2)}\n`);
      await write(join(dir, `${r.date}.md`), digestMarkdown(d));
      await recordEvents(r, r.candidates.slice(0, FLAGGED), (id) => pageUrl(id));
      ctx.log(`digest ${join(dir, `${r.date}.md`)}: ${d.flagged.length} flagged, ${r.xrayed.length} x-rayed`);
      if (r.problems.length) {
        for (const p of r.problems) ctx.log(`problem: ${p}`);
        process.exitCode = EXIT_DEGRADED;
      }
    },
  },
];
