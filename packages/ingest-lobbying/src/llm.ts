import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseJson } from "@antibody/core";
import { paths } from "@antibody/core/node";
import { z } from "zod";

const CACHE = join(paths.raw("lobbying"), "llm");

const Reply = z.object({ result: z.string().optional(), total_cost_usd: z.number().optional() });

export interface Answer<T> {
  value: T;
  costUsd: number;
  ms: number;
  cached: boolean;
}

export async function askJson<T>(
  prompt: string,
  schema: z.ZodType<T>,
  model = "opus",
  signal?: AbortSignal,
): Promise<Answer<T>> {
  await mkdir(CACHE, { recursive: true });
  const file = Bun.file(join(CACHE, `${createHash("sha1").update(`${model}\n${prompt}`).digest("hex")}.json`));

  if (await file.exists()) {
    const cached = z.object({ value: schema, costUsd: z.number(), ms: z.number() }).parse(await file.json());

    return { ...cached, cached: true };
  }

  const t0 = performance.now();
  let costUsd = 0;

  for (let attempt = 1; ; attempt++) {
    const proc = Bun.spawn(["claude", "-p", "--model", model, "--output-format", "json"], {
      env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "antibody" },
      stdin: new Blob([prompt]),
      stdout: "pipe",
      stderr: "pipe",
      signal: signal ?? new AbortController().signal,
    });

    const out = await new Response(proc.stdout).text();

    if ((await proc.exited) !== 0) {
      throw new Error(`claude -p failed: ${await new Response(proc.stderr).text()}`);
    }

    const body = Reply.parse(JSON.parse(out));
    costUsd += body.total_cost_usd ?? 0;
    let value: T;

    try {
      value = parseJson(body.result ?? "", schema);
    } catch (error) {
      if (attempt >= 3) {
        throw error;
      }

      continue;
    }

    const answer = { value, costUsd, ms: Math.round(performance.now() - t0) };
    await Bun.write(file, JSON.stringify(answer));

    return { ...answer, cached: false };
  }
}
