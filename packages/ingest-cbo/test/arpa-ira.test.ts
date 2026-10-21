import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { paths, readRows } from "@antibody/core/node";

const have = (bill: string) => existsSync(join(paths.table("cbo_lines"), `${bill}.jsonl`));
const deficitOf = async (bill: string, estimate: string) => {
  const lines = await readRows("cbo_lines", bill);
  return (num: string) => lines.find((l) => l.id === `${bill}.cbo-${estimate}:s${num}:deficit`);
};

test.skipIf(!have("117-hr-1319"))("ARPA: every title's sections carry CBO's dollars, Finance's too", async () => {
  const lines = await readRows("cbo_lines", "117-hr-1319");
  const nums = new Set(
    lines.filter((l) => l.line_kind === "section" && l.section_ids.length).map((l) => l.section_nums[0]!),
  );
  const titles = new Set([...nums].map((n) => n.slice(0, n.length - 3)));
  expect([...titles].sort((a, b) => Number(a) - Number(b))).toEqual([
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "11",
  ]);
  const section = await deficitOf("117-hr-1319", "57056");
  expect(Math.round(section("9704")!.total_musd)).toBe(81235);
  expect(section("9601")?.total_musd).toBe(412112);
  expect(section("9901")?.total_musd).toBe(362050);
  expect(section("9674")?.total_musd).toBe(-8403);
  expect(section("9901")?.section_ids).toEqual(["117-hr-1319@rh:title:V/subtitle:A/sec:5001"]);
});

test.skipIf(!have("117-hr-5376"))(
  "IRA: CBO's one row for sections 13903 and 13904 is split between them, not lost to a cut-off title",
  async () => {
    const section = await deficitOf("117-hr-5376", "58455");
    for (const num of ["13903", "13904"])
      expect(section(num)).toMatchObject({ total_musd: -26379.5, split: "even_split", join: "number" });
  },
);
