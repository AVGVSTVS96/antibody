import type { Row } from "@antibody/core";
import { blankToNull, column, fecDate, imageUrl, rows } from "./bulk.ts";

// https://www.fec.gov/campaign-finance-data/contributions-committees-candidates-file-description/
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

export const CONTRIBUTION_TYPES = new Set(["24K", "24Z"]);

const INDEPENDENT_EXPENDITURE_TYPES = new Map<string, "support" | "oppose">([
  ["24E", "support"],
  ["24A", "oppose"],
]);

export interface Pas2Result {
  contributions: Row<"contributions">[];
  independent: Row<"independent_expenditures">[];
  skipped: { memo: number; badDate: number };
}

export async function readPas2(cycle: number, byFec: Map<string, string>, dir?: string): Promise<Pas2Result> {
  const out: Pas2Result = { contributions: [], independent: [], skipped: { memo: 0, badDate: 0 } };

  for await (const f of rows("pas2", cycle, { dir })) {
    const candidate = f[C.CAND_ID] ?? "";
    const bioguide = byFec.get(candidate);
    const type = f[C.TRANSACTION_TP] ?? "";
    const support = INDEPENDENT_EXPENDITURE_TYPES.get(type);

    if (bioguide === undefined || bioguide === "" || !(CONTRIBUTION_TYPES.has(type) || support !== undefined)) {
      continue;
    }

    if (f[C.MEMO_CD] === "X") {
      out.skipped.memo++;
      continue;
    }

    const date = fecDate(f[C.TRANSACTION_DT]);

    const fact = {
      id: column(f, C.SUB_ID),
      pac_id: column(f, C.CMTE_ID),
      bioguide,
      candidate_id: candidate,
      amount_usd: Number(f[C.TRANSACTION_AMT]),
      cycle,
      source_url: imageUrl(column(f, C.IMAGE_NUM)),
      source_locator: `FEC filing ${f[C.FILE_NUM]}, transaction ${f[C.TRAN_ID]} (${type}); bulk pas2${String(cycle).slice(2)} sub_id ${f[C.SUB_ID]}`,
    };

    if (support !== undefined) {
      out.independent.push({ ...fact, date, support });
    } else if (date === null) {
      out.skipped.badDate++;
    } else {
      out.contributions.push({
        ...fact,
        date,
        recipient_committee_id: blankToNull(f[C.OTHER_ID]),
        transaction_type: type,
      });
    }
  }

  return out;
}

const CM = { CMTE_ID: 0, CMTE_NM: 1, CMTE_DSGN: 8, CMTE_TP: 9, CONNECTED_ORG_NM: 13 } as const;

export async function readPacs(cycles: number[], ids: Set<string>, dir?: string): Promise<Row<"pacs">[]> {
  const out = new Map<string, Row<"pacs">>();
  const latestFirst = cycles.toSorted((a, b) => b - a);

  for (const cycle of latestFirst) {
    for await (const f of rows("cm", cycle, { dir })) {
      const id = column(f, CM.CMTE_ID);

      if (!ids.has(id) || out.has(id)) {
        continue;
      }

      out.set(id, {
        id,
        name: column(f, CM.CMTE_NM),
        connected_org: blankToNull(f[CM.CONNECTED_ORG_NM]),
        type: blankToNull(f[CM.CMTE_TP]),
        designation: blankToNull(f[CM.CMTE_DSGN]),
        source_url: `https://www.fec.gov/data/committee/${id}/`,
        source_locator: `FEC committee master cm${String(cycle).slice(2)}`,
      });
    }
  }

  return [...out.values()];
}

export const givingUrl = (pacId: string, recipientCommitteeId: string | null, candidateId: string, cycle: number) =>
  recipientCommitteeId !== null && recipientCommitteeId !== ""
    ? `https://www.fec.gov/data/disbursements/?committee_id=${pacId}&recipient_committee_id=${recipientCommitteeId}&two_year_transaction_period=${cycle}`
    : `https://www.fec.gov/data/candidate/${candidateId}/?cycle=${cycle}`;
