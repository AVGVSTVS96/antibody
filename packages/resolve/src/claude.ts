import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJson } from "@antibody/core";
import { z } from "zod";
import { isNumber, isObject, isText } from "./is.ts";

export const MODEL = process.env.ANTIBODY_REVIEW_MODEL ?? "sonnet";

const objects = z.array(z.record(z.string(), z.unknown()));

interface Reply {
  result: string;
  total_cost_usd?: number;
  modelUsage?: object;
}

const isReply = (v: unknown): v is Reply =>
  isObject(v) &&
  "result" in v &&
  isText(v.result) &&
  (!("total_cost_usd" in v) || isNumber(v.total_cost_usd)) &&
  (!("modelUsage" in v) || isObject(v.modelUsage));

export async function askJson<T>(
  prompt: string,
  isItem: (v: unknown) => v is T,
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
    ...(signal && { signal }),
  });

  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);

  if ((await proc.exited) !== 0) {
    throw new Error(`claude -p failed: ${err.slice(0, 400) || out.slice(0, 400)}`);
  }

  const res: unknown = JSON.parse(out);

  if (!isReply(res)) {
    throw new Error(`claude -p reply has no result: ${out.slice(0, 400)}`);
  }

  const answers: unknown[] = parseJson(res.result, objects);
  const items = answers.filter(isItem);

  return { items, costUsd: res.total_cost_usd ?? 0, model: Object.keys(res.modelUsage ?? {})[0] ?? MODEL };
}

export async function pool<I, O>(items: I[], n: number, fn: (item: I, i: number) => Promise<O>): Promise<O[]> {
  const out: O[] = [];
  const queue = items.entries();

  const worker = async () => {
    for (const [i, item] of queue) {
      out[i] = await fn(item, i);
    }
  };

  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));

  return out;
}
