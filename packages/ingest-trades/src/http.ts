export const UA = "antibody research (hex-ai@agentmail.to)";

export async function download(url: string, path: string, headers: Record<string, string> = {}): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA, ...headers } }).catch(() => null);
    if (res?.ok) {
      await Bun.write(path, await res.arrayBuffer());
      return true;
    }
    if (res && res.status === 404) return false;
    await Bun.sleep(1000 * attempt);
  }
  return false;
}

export async function pool<T>(items: T[], workers: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
    }),
  );
}
