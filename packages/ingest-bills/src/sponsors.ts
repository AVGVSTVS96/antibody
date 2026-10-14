import { type BillId, billstatusUrl, type Row, type Stage } from "@antibody/core";
import { writeRows } from "@antibody/core/node";
import { billstatus, type Sponsor } from "@antibody/ingest-members";

const day = (d?: string) => d?.slice(0, 10) || null;

/** Sponsor and cosponsors from GovInfo BILLSTATUS, withdrawn cosponsors kept with their withdrawal date. */
export function sponsorRows(
  bill: BillId,
  b: { introducedDate?: string; sponsors?: { item?: Sponsor[] }; cosponsors?: { item?: Sponsor[] } },
): Row<"sponsorships">[] {
  const row = (s: Sponsor, role: "sponsor" | "cosponsor", locator: string): Row<"sponsorships"> => ({
    id: `${bill}:${s.bioguideId}`,
    bill_id: bill,
    bioguide: s.bioguideId,
    role,
    date: role === "sponsor" ? day(b.introducedDate) : day(s.sponsorshipDate),
    withdrawn_on: day(s.sponsorshipWithdrawnDate),
    source_url: billstatusUrl(bill),
    source_locator: `${locator}: ${s.fullName}`,
  });
  return [
    ...(b.sponsors?.item ?? []).map((s) => row(s, "sponsor", "sponsors")),
    ...(b.cosponsors?.item ?? []).map((s) => row(s, "cosponsor", "cosponsors")),
  ];
}

export const sponsorsStage: Stage = {
  name: "sponsors",
  scope: "bill",
  needs: [],
  writes: ["sponsorships"],
  async run({ bill, refresh, log }) {
    const status = await billstatus(bill!, refresh);
    if (!status) return log("GovInfo has no BILLSTATUS for this bill yet");
    const rows = sponsorRows(bill!, status);
    await writeRows("sponsorships", bill!, rows);
    log(
      `${rows.filter((r) => r.role === "cosponsor").length} cosponsors, ${rows.filter((r) => r.withdrawn_on).length} withdrawn`,
    );
  },
};
