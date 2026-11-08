import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bundle } from "@antibody/core";
import fixture from "../../core/fixtures/genius-mini.bundle.json";
import { pageUrl } from "../src/digest.ts";
import { publishBundle, updateSite } from "../src/site.ts";
import type { Site } from "../src/site.ts";

const dir = await mkdtemp(join(tmpdir(), "antibody-site-"));

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const withId = (id: string): Bundle => {
  const b = Bundle.parse(fixture);

  return Bundle.parse(JSON.parse(JSON.stringify(b).replaceAll(b.bill.id, id).replaceAll("S.1582", "S.9999")));
};

async function folders(name: string) {
  const root = join(dir, name);
  const local = join(root, "local");
  const published = join(root, "published");
  await mkdir(local, { recursive: true });
  await mkdir(published, { recursive: true });

  return { local, published, root };
}

test("a sound x-ray bundle is published with its claims sidecar", async () => {
  const f = await folders("sound");
  await Bun.write(join(f.local, "119-s-9999.json"), JSON.stringify(withId("119-s-9999")));
  expect(await publishBundle("119-s-9999", f.local, f.published)).toBeNull();
  expect(await Bun.file(join(f.published, "119-s-9999.json")).exists()).toBe(true);
  expect(await Bun.file(join(f.published, "119-s-9999.claims.json")).exists()).toBe(true);
});

test("a bundle with a dangling claim is not published and the reason comes back", async () => {
  const f = await folders("broken");
  const broken = withId("119-s-9998");
  const [edge] = broken.edges;

  if (!edge) {
    throw new Error("the fixture bundle has no edges");
  }

  broken.edges.push({ ...edge, id: "x", dst: "member:NOPE" });
  await Bun.write(join(f.local, "119-s-9998.json"), JSON.stringify(broken));
  expect(await publishBundle("119-s-9998", f.local, f.published)).toContain("checkBundle problems");
  expect(await Bun.file(join(f.published, "119-s-9998.json")).exists()).toBe(false);
});

test("a curated bill's published bundle is never overwritten by the watcher", async () => {
  const f = await folders("curated");
  await Bun.write(join(f.local, "119-s-1582.json"), JSON.stringify(fixture));
  expect(await publishBundle("119-s-1582", f.local, f.published)).toBeNull();
  expect(await Bun.file(join(f.published, "119-s-1582.json")).exists()).toBe(false);
});

const site = (): Site => ({ published: [], deploy: { status: "pending" } });

async function setup(name: string) {
  const f = await folders(name);
  await Bun.write(join(f.published, "119-s-1582.json"), JSON.stringify({ ...fixture, claims: {} }));
  const calls: string[][] = [];

  // oxlint-disable-next-line eslint/require-await -- stands in for the async exec; promise-function-async wants it async
  const exec = async (cmd: string[]) => {
    calls.push(cmd);

    return cmd.includes("deploy")
      ? 'Production https://antibody-abc123.vercel.app\n{\n  "url": "https://antibody-abc123.vercel.app",\n}\n'
      : "";
  };

  const where = { root: f.root, published: f.published, deployedIndex: join(f.root, "deployed-index.json") };

  return { calls, exec, where };
}

test("deploy builds, deploys to production and remembers the index; an identical index is not redeployed", async () => {
  const { calls, exec, where } = await setup("deploy");
  const first = site();
  expect((await updateSite(first, { exec, where })).problems).toEqual([]);
  expect(first.deploy).toEqual({ status: "deployed", url: "https://antibody-abc123.vercel.app" });
  expect(calls.map((c) => c.slice(0, 3).join(" "))).toEqual([
    "bun run --cwd",
    "bunx vercel build",
    "bunx vercel deploy",
  ]);
  const again = site();
  await updateSite(again, { exec, where });
  expect(again.deploy).toEqual({ status: "unchanged" });
  expect(calls).toHaveLength(3);
});

test("a failed deploy is a problem, keeps the old snapshot, and the next run retries", async () => {
  const { calls, exec, where } = await setup("failed");
  const s = site();

  const { problems } = await updateSite(s, {
    // oxlint-disable-next-line eslint/require-await -- stands in for the async exec; promise-function-async wants it async
    exec: async () => {
      throw new Error("failed (1): bunx vercel build");
    },
    where,
  });

  expect(s.deploy.status).toBe("failed");
  expect(problems[0]).toContain("previous live site is unchanged");
  expect(await Bun.file(where.deployedIndex).exists()).toBe(false);
  const retry = site();
  await updateSite(retry, { exec, where });
  expect(retry.deploy.status).toBe("deployed");
  expect(calls).toHaveLength(3);
});

test("deploy can be turned off; the index is still rebuilt", async () => {
  const { calls, exec, where } = await setup("off");
  const s = site();
  const { index } = await updateSite(s, { deploy: false, exec, where });
  expect(s.deploy.status).toBe("disabled");
  expect(index?.bills.map((b) => b.id)).toEqual(["119-s-1582"]);
  expect(calls).toEqual([]);
});

test("the digest's page link points at the live site once published", () => {
  expect(pageUrl("119-hr-1", false)).toBeNull();
  expect(pageUrl("119-hr-1")).toBe("https://antibody-murex.vercel.app/bill/119-hr-1");
});
