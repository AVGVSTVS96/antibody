import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { paths, readRows } from "@antibody/core/node";

const have = existsSync(join(paths.table("cbo_lines"), "119-hr-1.jsonl"));

test.skipIf(!have)("OBBBA: a section's figure is the row CBO printed for that section", async () => {
  const lines = await readRows("cbo_lines", "119-hr-1");
  const deficit = (est: string, num: string) =>
    lines.find((l) => l.id === `119-hr-1.cbo-${est}:s${num}:deficit`)?.total_musd;
  expect(deficit("61461", "112207")).toBe(15);
  expect(deficit("61533", "70120")).toBe(142413);
  expect(deficit("61533", "71119")).toBe(-33968);
});

test.skipIf(!have)("OBBBA: no section line is also a group line, so no dollars are counted twice", async () => {
  const lines = await readRows("cbo_lines", "119-hr-1");
  const ids = lines.map((l) => l.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(lines.filter((l) => l.line_kind === "section" && l.section_nums.length > 1)).toEqual([]);
});
