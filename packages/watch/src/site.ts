import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type BillId, Bundle, type BundleIndex, billDisplay, checkBundle } from "@antibody/core";
import { heavy, paths, ROOT } from "@antibody/core/node";
import { CURATED, writeBundle, writeIndex } from "@antibody/store";

export const SITE_URL = "https://antibody-murex.vercel.app";

export type Deploy =
  | { status: "pending" }
  | { status: "deployed"; url: string }
  | { status: "unchanged" }
  | { status: "disabled"; reason: string }
  | { status: "failed"; error: string };

export interface Site {
  /** X-rayed watcher bills copied into the published folder this run. */
  published: BillId[];
  deploy: Deploy;
}

const curated = new Set<string>(CURATED.map((p) => p.id));

/** The x-ray's bundle goes to the site only if it parses and every claim and edge resolves; curated bills are left as they are. */
export async function publishBundle(id: BillId, from = paths.bundles, to = paths.published): Promise<string | null> {
  if (curated.has(id)) return null;
  const parsed = Bundle.safeParse(await Bun.file(join(from, `${id}.json`)).json());
  if (!parsed.success)
    return `${billDisplay(id)} bundle not published, it does not parse: ${parsed.error.message.slice(0, 200)}`;
  const problems = checkBundle(parsed.data);
  if (problems.length)
    return `${billDisplay(id)} bundle not published, ${problems.length} checkBundle problems: ${problems.slice(0, 3).join("; ")}`;
  await writeBundle(parsed.data, { publish: true, local: from, published: to });
  return null;
}

export const deployDisabled = () => process.env.ANTIBODY_WATCH_DEPLOY === "0";

type Run = (cmd: string[], cwd: string, signal: AbortSignal) => Promise<string>;

const run: Run = (cmd, cwd, signal) => heavy(cmd, { cwd, signal });

const withoutStamp = (index: string) => index.replace(/"generatedAt": "[^"]*"/, "");

interface Where {
  published: string;
  web: string;
  /** The index of the last successful deploy; a deploy is skipped while the new index matches it. */
  deployedIndex: string;
}

const here = (): Where => ({
  published: paths.published,
  web: join(ROOT, "apps/web"),
  deployedIndex: join(paths.raw("watch"), "deployed-index.json"),
});

/**
 * Rebuilds the index with this run's picks, then builds the site and puts it on production unless the index is
 * the same as at the last deploy (apart from generatedAt). Never throws: a failure comes back as a problem and
 * the previous live site stays, because Vercel only switches production once the new deploy is ready.
 */
export async function updateSite(
  site: Site,
  { deploy = !deployDisabled(), exec = run, where = here(), minutes = 20 } = {},
): Promise<{ index: BundleIndex | null; problems: string[] }> {
  const problems: string[] = [];
  let index: BundleIndex | null = null;
  try {
    index = await writeIndex(
      where.published,
      CURATED.map((p) => p.id),
    );
  } catch (e) {
    site.deploy = { status: "failed", error: `index not rebuilt: ${(e as Error).message}` };
    return { index, problems: [`site: ${site.deploy.error}`] };
  }
  if (!deploy) {
    site.deploy = { status: "disabled", reason: "ANTIBODY_WATCH_DEPLOY=0 or --no-deploy" };
    return { index, problems };
  }
  const text = await Bun.file(join(where.published, "index.json")).text();
  const before = await Bun.file(where.deployedIndex)
    .text()
    .catch(() => null);
  if (before !== null && withoutStamp(before) === withoutStamp(text)) {
    site.deploy = { status: "unchanged" };
    return { index, problems };
  }
  const signal = AbortSignal.timeout(minutes * 60_000);
  try {
    await exec(["bun", "run", "--cwd", "apps/web", "build"], ROOT, signal);
    await exec(["bunx", "vercel", "build", "--prod", "--yes"], where.web, signal);
    const out = await exec(["bunx", "vercel", "deploy", "--prebuilt", "--prod", "--yes"], where.web, signal);
    const url = out.match(/https:\/\/\S+/g)?.at(-1) ?? SITE_URL;
    await mkdir(dirname(where.deployedIndex), { recursive: true });
    await Bun.write(`${where.deployedIndex}.tmp`, text);
    await rename(`${where.deployedIndex}.tmp`, where.deployedIndex);
    site.deploy = { status: "deployed", url };
  } catch (e) {
    const error = signal.aborted ? `stopped after ${minutes} min` : (e as Error).message;
    site.deploy = { status: "failed", error };
    problems.push(`site deploy failed, the previous live site is unchanged and the next run retries: ${error}`);
  }
  return { index, problems };
}
