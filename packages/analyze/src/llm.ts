/**
 * One `claude -p` call with no tools and no user settings, returning the model's text. The server has no API key;
 * Claude Code's own login pays for it.
 */
export async function claude(
  prompt: string,
  opts: { system: string; model: string; signal?: AbortSignal },
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
    { stdin: new Blob([prompt]), stdout: "pipe", stderr: "pipe", cwd: "/tmp", signal: opts.signal },
  );
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if ((await proc.exited) !== 0) throw new Error(`claude -p failed: ${err.slice(0, 300) || out.slice(0, 300)}`);
  const r = JSON.parse(out) as { result: string; is_error?: boolean; total_cost_usd: number; modelUsage: object };
  if (r.is_error) throw new Error(`claude -p error: ${r.result}`);
  return { text: r.result, costUsd: r.total_cost_usd, model: Object.keys(r.modelUsage)[0] ?? opts.model };
}

/** The first JSON value in a model reply (it sometimes wraps it in a code fence). */
export function parseJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1]! : text).trim();
  const start = body.search(/[[{]/);
  return JSON.parse(body.slice(start)) as T;
}

/** Runs tasks with at most `n` in flight. */
export async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
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
