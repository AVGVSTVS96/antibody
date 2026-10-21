import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJson } from "@antibody/core";

export const MODEL = process.env.ANTIBODY_REVIEW_MODEL ?? "sonnet";

/**
 * One `claude -p` call with no tools, settings or MCP servers, returning the JSON array in its answer.
 * Runs from an empty folder so no project instructions leak into the judgment.
 */
export async function askJson<T>(
  prompt: string,
  signal?: AbortSignal,
): Promise<{ items: T[]; costUsd: number; model: string }> {
  const cwd = join(tmpdir(), "antibody-review");
  await mkdir(cwd, { recursive: true });
  const args = ["claude", "-p", "--model", MODEL, "--tools", "", "--strict-mcp-config", "--setting-sources", ""];
  const proc = Bun.spawn([...args, "--no-session-persistence", "--output-format", "json"], {
    cwd,
    stdin: new Blob([prompt]),
    stdout: "pipe",
    stderr: "pipe",
    signal,
  });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if ((await proc.exited) !== 0) throw new Error(`claude -p failed: ${err.slice(0, 400) || out.slice(0, 400)}`);
  const res = JSON.parse(out) as { result: string; total_cost_usd?: number; modelUsage?: Record<string, unknown> };
  const items = parseJson<T[]>(res.result);
  return { items, costUsd: res.total_cost_usd ?? 0, model: Object.keys(res.modelUsage ?? {})[0] ?? MODEL };
}

/** Runs `fn` over `items` with at most `n` in flight. */
export async function pool<I, O>(items: I[], n: number, fn: (item: I, i: number) => Promise<O>): Promise<O[]> {
  const out: O[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
