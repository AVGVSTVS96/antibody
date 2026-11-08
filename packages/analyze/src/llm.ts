import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const emptyDir = join(homedir(), ".cache", "claude-empty");

mkdirSync(emptyDir, { recursive: true });

const ClaudeJson = z.object({
  result: z.string(),
  is_error: z.boolean().optional(),
  total_cost_usd: z.number(),
  modelUsage: z.record(z.string(), z.unknown()),
});

export async function claude(
  prompt: string,
  opts: { system: string; model: string; signal?: AbortSignal | undefined },
): Promise<{ text: string; costUsd: number; model: string }> {
  const proc = Bun.spawn(
    [
      "claude",
      "-p",
      "--model",
      opts.model,
      "--safe-mode",
      "--tools",
      "",
      "--no-session-persistence",
      "--output-format",
      "json",
      "--system-prompt",
      opts.system,
    ],
    {
      env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "antibody" },
      stdin: new Blob([prompt]),
      stdout: "pipe",
      stderr: "pipe",
      cwd: emptyDir,
      signal: opts.signal ?? new AbortController().signal,
    },
  );

  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);

  if ((await proc.exited) !== 0) {
    throw new Error(`claude -p failed: ${err.slice(0, 300) || out.slice(0, 300)}`);
  }

  const r = ClaudeJson.parse(JSON.parse(out));

  if (r.is_error === true) {
    throw new Error(`claude -p error: ${r.result}`);
  }

  return { text: r.result, costUsd: r.total_cost_usd, model: Object.keys(r.modelUsage)[0] ?? opts.model };
}

export const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export async function pool<T, R>(items: T[], inFlight: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  const queue = items.entries();

  const worker = async () => {
    for (const [i, item] of queue) {
      out[i] = await fn(item, i);
    }
  };

  await Promise.all(Array.from({ length: Math.min(inFlight, items.length) }, worker));

  return out;
}
