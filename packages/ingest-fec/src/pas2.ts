import type { Row } from "@antibody/core";
import { fecDate, imageUrl, rows } from "./bulk.ts";

/** itpas2.txt columns, from https://www.fec.gov/campaign-finance-data/contributions-committees-candidates-file-description/ */
const C = {
  CMTE_ID: 0,
  IMAGE_NUM: 4,
  TRANSACTION_TP: 5,
  TRANSACTION_DT: 13,
  TRANSACTION_AMT: 14,
  OTHER_ID: 15,
  CAND_ID: 16,
  TRAN_ID: 17,
  FILE_NUM: 18,
  MEMO_CD: 19,
  SUB_ID: 21,
} as const;

/** 24K cash and 24Z in-kind are money given to the campaign; 24E/24A are spent for or against it, independently. */
export const CONTRIBUTION_TYPES = new Set(["24K", "24Z"]);
const IE_TYPES: Record<string, "support" | "oppose"> = { "24E": "support", "24A": "oppose" };

export interface Pas2Result {
  contributions: Row<"contributions">[];
  independent: Row<"independent_expenditures">[];
  skipped: { memo: number; badDate: number };
}

/** Every pas2 transaction aimed at a member of Congress (by their FEC candidate ids) in one cycle. */
export async function readPas2(cycle: number, byFec: Map<string, string>, dir?: string): Promise<Pas2Result> {
  const out: Pas2Result = { contributions: [], independent: [], skipped: { memo: 0, badDate: 0 } };
  for await (const f of rows("pas2", cycle, { dir })) {
    const candidate = f[C.CAND_ID] ?? "";
    const bioguide = byFec.get(candidate);
    const type = f[C.TRANSACTION_TP]!;
    if (!bioguide || !(CONTRIBUTION_TYPES.has(type) || type in IE_TYPES)) continue;
    if (f[C.MEMO_CD] === "X") {
      out.skipped.memo++;
      continue;
    }
    const date = fecDate(f[C.TRANSACTION_DT]);
    const fact = {
      id: f[C.SUB_ID]!,
      pac_id: f[C.CMTE_ID]!,
      bioguide,
      candidate_id: candidate,
      amount_usd: Number(f[C.TRANSACTION_AMT]),
      cycle,
      source_url: imageUrl(f[C.IMAGE_NUM]!),
      source_locator: `FEC filing ${f[C.FILE_NUM]}, transaction ${f[C.TRAN_ID]} (${type}); bulk pas2${String(cycle).slice(2)} sub_id ${f[C.SUB_ID]}`,
    };
    if (type in IE_TYPES) out.independent.push({ ...fact, date, support: IE_TYPES[type]! });
    else if (!date) out.skipped.badDate++;
    else
      out.contributions.push({ ...fact, date, recipient_committee_id: f[C.OTHER_ID] || null, transaction_type: type });
  }
  return out;
}

/** cm.txt columns. */
const CM = { CMTE_ID: 0, CMTE_NM: 1, CMTE_DSGN: 8, CMTE_TP: 9, CONNECTED_ORG_NM: 13 } as const;

/** Committee master rows for the given ids, the latest cycle's record winning. */
export async function readPacs(cycles: number[], ids: Set<string>, dir?: string): Promise<Row<"pacs">[]> {
  const out = new Map<string, Row<"pacs">>();
  for (const cycle of [...cycles].sort((a, b) => b - a))
    for await (const f of rows("cm", cycle, { dir })) {
      const id = f[CM.CMTE_ID]!;
      if (!ids.has(id) || out.has(id)) continue;
      out.set(id, {
        id,
        name: f[CM.CMTE_NM]!,
        connected_org: f[CM.CONNECTED_ORG_NM] || null,
        type: f[CM.CMTE_TP] || null,
        designation: f[CM.CMTE_DSGN] || null,
        source_url: `https://www.fec.gov/data/committee/${id}/`,
        source_locator: `FEC committee master cm${String(cycle).slice(2)}`,
      });
    }
  return [...out.values()];
}

/** fec.gov list of every payment from one committee to one campaign in a cycle: the `allTxnsUrl` of a funded edge. */
export const givingUrl = (pacId: string, recipientCommitteeId: string | null, candidateId: string, cycle: number) =>
  recipientCommitteeId
    ? `https://www.fec.gov/data/disbursements/?committee_id=${pacId}&recipient_committee_id=${recipientCommitteeId}&two_year_transaction_period=${cycle}`
    : `https://www.fec.gov/data/candidate/${candidateId}/?cycle=${cycle}`;
