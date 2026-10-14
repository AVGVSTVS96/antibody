import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RULES_URL } from "../src/lib/format.ts";

const root = join(import.meta.dir, "../../..");
const headings = new Set(
  [...readFileSync(join(root, "docs/rules.md"), "utf8").matchAll(/^## (.+)$/gm)].map((m) => m[1]),
);
const sources = (readdirSync(join(root, "apps/web/src"), { recursive: true }) as string[])
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => readFileSync(join(root, "apps/web/src", f), "utf8"));

test("the rules page is the one on the design-v2 branch", () => {
  expect(RULES_URL).toContain("/blob/design-v2/docs/rules.md");
});

test("every rule anchor the pages link exists in docs/rules.md", () => {
  const anchors = sources.flatMap((s) => [
    ...[...s.matchAll(/RULES_URL\}#([a-z0-9-]+)/g)].map((m) => m[1]!),
    ...[...s.matchAll(/ruleUrl\("([a-z0-9-]+)"\)/g)].map((m) => m[1]!),
  ]);
  expect(anchors.length).toBeGreaterThan(0);
  for (const a of anchors) expect(headings.has(a)).toBe(true);
});
