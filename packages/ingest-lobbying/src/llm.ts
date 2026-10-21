import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseJson } from "@antibody/core";
import { paths } from "@antibody/core/node";

const CACHE = join(paths.raw("lobbying"), "llm");

export interface Answer<T> {
  value: T;
  costUsd: number;
  ms: number;
  cached: boolean;
}

/**
 * Asks Claude through the `claude` CLI (the server has no API key) and parses the JSON in its answer.
 * Answers are cached by prompt and model, so a re-run costs nothing.
 */
export async function askJson<T>(prompt: string, model = "opus", signal?: AbortSignal): Promise<Answer<T>> {
  await mkdir(CACHE, { recursive: true });
  const file = Bun.file(join(CACHE, `${createHash("sha1").update(`${model}\n${prompt}`).digest("hex")}.json`));
  if (await file.exists()) return { ...(await file.json()), cached: true };
  const t0 = performance.now();
  const proc = Bun.spawn(["claude", "-p", "--model", model, "--output-format", "json"], {
    stdin: new Blob([prompt]),
    stdout: "pipe",
    stderr: "pipe",
    signal,
  });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error(`claude -p failed: ${await new Response(proc.stderr).text()}`);
  const body = JSON.parse(out) as { result: string; total_cost_usd?: number };
  const answer = {
    value: parseJson<T>(body.result),
    costUsd: body.total_cost_usd ?? 0,
    ms: Math.round(performance.now() - t0),
  };
  await Bun.write(file, JSON.stringify(answer));
  return { ...answer, cached: false };
}
