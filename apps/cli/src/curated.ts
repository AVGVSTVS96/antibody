import type { BillId } from "@antibody/core";

export interface Pick {
  id: BillId;
  name: string;
  /** Party of the sponsor of the bill that became law, per its BILLSTATUS record. */
  ledBy: "R" | "D";
  sponsor: string;
  law: string;
}

/**
 * The bills `antibody build` x-rays for the site: six led by each party, alternating. "Led by" is the sponsor's
 * party on the measure that became law (a vehicle bill's sponsor counts, as BILLSTATUS records it). Every id,
 * sponsor and law number was checked against GovInfo BILLSTATUS on 2026-10-13.
 */
export const CURATED: Pick[] = [
  { id: "119-s-1582", name: "GENIUS Act", ledBy: "R", sponsor: "Sen. Hagerty [R-TN]", law: "119-27" },
  {
    id: "117-hr-5376",
    name: "Inflation Reduction Act of 2022",
    ledBy: "D",
    sponsor: "Rep. Yarmuth [D-KY-3]",
    law: "117-169",
  },
  {
    id: "119-hr-1",
    name: "One Big Beautiful Bill Act",
    ledBy: "R",
    sponsor: "Rep. Arrington [R-TX-19]",
    law: "119-21",
  },
  {
    id: "117-hr-1319",
    name: "American Rescue Plan Act of 2021",
    ledBy: "D",
    sponsor: "Rep. Yarmuth [D-KY-3]",
    law: "117-2",
  },
  { id: "119-s-5", name: "Laken Riley Act", ledBy: "R", sponsor: "Sen. Britt [R-AL]", law: "119-1" },
  { id: "117-hr-4346", name: "CHIPS and Science Act", ledBy: "D", sponsor: "Rep. Ryan [D-OH-13]", law: "117-167" },
  { id: "119-s-146", name: "TAKE IT DOWN Act", ledBy: "R", sponsor: "Sen. Cruz [R-TX]", law: "119-12" },
  {
    id: "117-hr-3684",
    name: "Infrastructure Investment and Jobs Act",
    ledBy: "D",
    sponsor: "Rep. DeFazio [D-OR-4]",
    law: "117-58",
  },
  {
    id: "118-hr-3746",
    name: "Fiscal Responsibility Act of 2023",
    ledBy: "R",
    sponsor: "Rep. McHenry [R-NC-10]",
    law: "118-5",
  },
  { id: "117-s-3373", name: "Honoring our PACT Act of 2022", ledBy: "D", sponsor: "Sen. Kaine [D-VA]", law: "117-168" },
  {
    id: "119-s-1071",
    name: "National Defense Authorization Act for Fiscal Year 2026",
    ledBy: "R",
    sponsor: "Sen. Cornyn [R-TX]",
    law: "119-60",
  },
  {
    id: "117-hr-2617",
    name: "Consolidated Appropriations Act, 2023",
    ledBy: "D",
    sponsor: "Rep. Connolly [D-VA-11]",
    law: "117-328",
  },
];
