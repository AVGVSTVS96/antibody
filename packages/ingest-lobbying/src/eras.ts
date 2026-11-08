import type { BillId } from "@antibody/core";

const REWRITTEN: Partial<Record<BillId, { on: string; oldName: RegExp; newName: RegExp; was: string }>> = {
  "117-hr-5376": {
    on: "2022-07-27",
    oldName: /build back better|\bBBB\b/iu,
    newName: /inflation reduction/iu,
    was: "the Build Back Better Act",
  },
};

export function earlierBill(bill: BillId, periodEnd: string, text: string): string | null {
  const era = REWRITTEN[bill];

  if (!era) {
    return null;
  }

  if (periodEnd < era.on) {
    return `filed for a period ending ${periodEnd}, before ${era.on}, when the Senate replaced this number's text; until then it was ${era.was}`;
  }

  if (era.oldName.test(text) && !era.newName.test(text)) {
    return `the filing calls it ${era.was}, the bill this number carried before ${era.on}`;
  }

  return null;
}
