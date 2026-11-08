import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { paths } from "@antibody/core/node";
import { ingestBill, sectionParts } from "@antibody/ingest-bills";
import { reach } from "../src/reach.ts";
import { must } from "./rows.ts";

const RAW = join(paths.raw("bills"), "raw");
const have = (...files: string[]) => files.every((f) => existsSync(join(RAW, f)));

if (have("BILLSTATUS-119hr1.xml", "BILLS-119hr1rh.xml", "BILLS-119hr1pcs.xml", "PLAW-119publ21.xml")) {
  const { rows } = await ingestBill("119-hr-1", { write: false, llm: false });
  const sections = must(rows.sections);

  const parts = await sectionParts(sections, must(rows.versions), {
    lateUnavailable: must(must(rows.bills)[0]).late_unavailable,
  });

  describe("H.R.1, read in parts", () => {
    test("the House's AI moratorium is a part of its own, with the state-law reach, though the Senate dropped it", () => {
      const ai = must(sections.find((s) => s.id === "119-hr-1@rh:title:IV/subtitle:C/part:2/sec:43201"));
      expect(ai.in_final).toBe(false);
      const moratorium = must(parts.find((p) => p.sectionId === ai.id && /moratorium/iu.test(p.heading)));
      expect(moratorium.num).toBe("43201(c)");
      expect(moratorium.text).toMatch(/no State or political subdivision thereof may enforce/iu);
      expect(reach(moratorium.text).map((t) => t.kind)).toContain("states");
      const others = parts.filter((p) => p.sectionId === ai.id && p !== moratorium);
      expect(others.some((p) => reach(p.text).some((t) => t.kind === "states"))).toBe(false);
    });

    test("every part is read from the last text its section was in and is no longer than its section", () => {
      const byId = new Map(sections.map((s) => [s.id, s]));

      for (const p of parts) {
        const s = must(byId.get(p.sectionId));
        expect(p.version).toBe(must(Object.keys(s.history).at(-1)));
        expect(p.words).toBeLessThanOrEqual(s.words);
      }
    });
  });
}
