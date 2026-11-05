import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { paths } from "@antibody/core/node";
import { ingestBill, sectionParts } from "@antibody/ingest-bills";
import { reach } from "../src/reach.ts";

/**
 * Riders reporters found inside long sections, checked against the GovInfo downloads in data/bills/raw when they are
 * there (the server); skipped in CI, like packages/ingest-bills/test/big-bills.test.ts.
 */
const RAW = join(paths.raw("bills"), "raw");
const have = (...files: string[]) => files.every((f) => existsSync(join(RAW, f)));

if (have("BILLSTATUS-119hr1.xml", "BILLS-119hr1rh.xml", "BILLS-119hr1pcs.xml", "PLAW-119publ21.xml"))
  describe("H.R.1, read in parts", async () => {
    const { rows } = await ingestBill("119-hr-1", { write: false, llm: false });
    const parts = await sectionParts(rows.sections!, rows.versions!, {
      lateUnavailable: rows.bills![0]!.late_unavailable,
    });

    // "Ban on AI regulations tucked into 'big, beautiful bill'" (Washington Examiner, May 2025): the House put a
    // ten-year bar on state AI laws in subsection (c) of a section headed for a $500 million IT modernization fund.
    test("the House's AI moratorium is a part of its own, with the state-law reach, though the Senate dropped it", () => {
      const ai = rows.sections!.find((s) => s.id === "119-hr-1@rh:title:IV/subtitle:C/part:2/sec:43201")!;
      expect(ai.in_final).toBe(false);
      const moratorium = parts.find((p) => p.sectionId === ai.id && /moratorium/i.test(p.heading))!;
      expect(moratorium.num).toBe("43201(c)");
      expect(moratorium.text).toMatch(/no State or political subdivision thereof may enforce/i);
      expect(reach(moratorium.text).map((t) => t.kind)).toContain("states");
      const others = parts.filter((p) => p.sectionId === ai.id && p !== moratorium);
      expect(others.some((p) => reach(p.text).some((t) => t.kind === "states"))).toBe(false);
    });

    test("every part is read from the last text its section was in and is no longer than its section", () => {
      const byId = new Map(rows.sections!.map((s) => [s.id, s]));
      for (const p of parts) {
        const s = byId.get(p.sectionId)!;
        expect(p.version).toBe(Object.keys(s.history).at(-1)!);
        expect(p.words).toBeLessThanOrEqual(s.words);
      }
    });
  });
