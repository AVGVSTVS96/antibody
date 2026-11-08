import { join } from "node:path";
import { paths } from "@antibody/core/node";
import type { Resolved } from "../src/resolve.ts";

export async function loadOutcomes(): Promise<Resolved["outcomes"]> {
  const file = Bun.file(join(paths.raw("entities"), "resolve", "dev-outcomes.json"));

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/require-safety-comment-for-type-assertion -- dev-run.ts writes this file from Resolved["outcomes"]
  return (await file.json()) as Resolved["outcomes"];
}
