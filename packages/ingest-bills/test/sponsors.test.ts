import { expect, test } from "bun:test";
import { TABLES } from "@antibody/core";
import { sponsorRows } from "../src/sponsors.ts";

test("sponsor dated by introduction, cosponsors by their own date, withdrawals kept", () => {
  const rows = sponsorRows("119-s-1582", {
    introducedDate: "2025-05-01",
    sponsors: { item: [{ bioguideId: "H000601", fullName: "Sen. Hagerty, Bill [R-TN]" }] },
    cosponsors: {
      item: [
        {
          bioguideId: "X000001",
          fullName: "Sen. Example [D-ZZ]",
          sponsorshipDate: "2025-05-07",
          sponsorshipWithdrawnDate: "2025-06-01",
        },
      ],
    },
  });
  expect(rows.map((r) => [r.id, r.role, r.date, r.withdrawn_on])).toEqual([
    ["119-s-1582:H000601", "sponsor", "2025-05-01", null],
    ["119-s-1582:X000001", "cosponsor", "2025-05-07", "2025-06-01"],
  ]);
  for (const r of rows) expect(TABLES.sponsorships.schema.safeParse(r).success).toBe(true);
});
