import type { Claim, TableName } from "@antibody/core";
import { RULES_URL } from "./format.ts";

/** What each kind of claim does not show, keyed by the table its id starts with. A table with both kinds names both. */
const NOT_SHOWN: Partial<Record<TableName, { fact?: string; inference?: string }>> = {
  amendment_sections: {
    inference:
      "Who wrote the section or why it was added. It says which agreed amendment the section's wording came with, read from the printed texts. No record names the section.",
  },
  amendments: {
    fact: "Which sections the amendment changed, or what it did. It shows that the amendment was offered and what happened to it.",
  },
  articles: {
    fact: "That the article is accurate, or that it covers any one section. It shows that this outlet published this headline on this date.",
  },
  attention: {
    inference:
      "That news outlets ignored a section on purpose, or that the section does not matter. It counts the articles we read that mention the section, ranked within this bill. “0 of N” means none of the N we read, not that no news covered it.",
  },
  benefits: {
    inference:
      "That the company gained from the bill or shaped it. A tie means the company lobbied on the bill: a filing names it. Nothing more.",
  },
  bill_committees: {
    fact: "That the committee changed the bill or held a hearing on it. It shows the referral only.",
  },
  bills: {
    fact: "What the bill does. It shows the bill's number, title, status and dates.",
  },
  cbo_estimates: {
    fact: "That CBO's numbers are right, or that every section has one. It shows that CBO scored this version of the bill against this baseline.",
  },
  cbo_lines: {
    fact: "That the money gets spent, or who gets it. It is CBO's projection for the years shown, against the baseline CBO names, with CBO's sign: a positive number adds to the deficit, a negative one cuts it. Another baseline gives another number.",
    inference:
      "That CBO gave this section this number. CBO printed one line for several sections. The share shown is an even split, and it is not counted toward the section's stakes.",
  },
  cbo_notes: {
    inference:
      "That CBO tied this sentence to the section. A model linked them. The quote is checked word for word against the CBO page, but the link between the sentence and the section is a judgment.",
  },
  committee_members: {
    fact: "That the member shaped this bill. It shows a committee seat in this Congress, not what the member did with the bill.",
  },
  committees: {
    fact: "What the committee did with any bill. It names a committee.",
  },
  companies: {
    fact: "That the company is tied to any bill. It identifies the company by its SEC record. Ties come from a separate rule.",
  },
  contributions: {
    fact: "Why the committee gave, or any link between a gift and a vote, a section or a trade. It shows one gift as the FEC filing lists it, not everything the committee or the member received.",
  },
  counterparts: {
    inference:
      "That the two sections are the same, or that the same people wrote them. A model judged that one section does the same job in law as the other. Its reasoning is the only evidence.",
  },
  lda_bill_refs: {
    fact: "What the client asked for, or whether it backed or opposed the bill. It shows that the filing says the client lobbied on this bill, in the words of its issue line.",
  },
  lda_clients: {
    fact: "That the client is a company we tie to a stock. It lists the names this client files under.",
  },
  lda_filings: {
    fact: "How much of the spending was about this bill. The expense figure covers everything the client lobbied on that quarter, not only this bill.",
  },
  lda_lobbyists: {
    fact: "That the person influenced the bill, or holds that job today. It shows the covered position as the lobbyist wrote it on the filing.",
  },
  lda_spend: {
    fact: "How much was spent on this bill. It adds up the totals reported on the filings that name the bill, and each total covers every issue the filing lists. The filings it adds are under “rests on”.",
  },
  lda_topic_refs: {
    inference:
      "That the filing is about this bill. The issue line describes a subject and names no bill. We take it to be about this bill only as a dashed inference.",
  },
  member_votes: {
    fact: "Why the member voted that way, or whether they read or shaped the bill. It is one vote on one roll call, not a vote on any one section.",
  },
  members: {
    fact: "That the member did anything on this bill. It shows who they are: party, chamber, state and term.",
  },
  pacs: {
    fact: "That the committee gave to anyone. It identifies a political committee and the company the FEC lists as connected to it.",
  },
  resolutions: {
    inference:
      "That every filing or trade under this name belongs to this company. It matches a name to a company on the SEC's list by the rule named above. If the names differ, check the filing.",
  },
  ptr_documents: {
    fact: "That the member traded anything. It shows that a periodic transaction report was filed and whether we have read it. Paper filings we have not read are missing from every trade count.",
  },
  roll_calls: {
    fact: "How any one member voted, or what any section did. It shows the question, the totals and the result of one roll call.",
  },
  section_scores: {
    inference:
      "That a section was hidden on purpose, or that it is bad. “Quiet and costly” means big stakes, late or off-topic, and little news in the articles we read. The rule never looks at party, sponsor or outlet.",
  },
  sections: {
    fact: "What the section does or costs. It shows that the section exists in this version, where it sits, and when it first appeared.",
  },
  sponsorships: {
    fact: "That the sponsor wrote any particular section. It shows who sponsored or cosponsored the bill, and when.",
  },
  trades: {
    fact: "Why the trade was made, whether the member chose it, or any link between it and the bill. It is a routine disclosure. The owner on the form may be a spouse or dependent, and the amount is a range, not a value.",
  },
  versions: {
    fact: "What changed between versions. It shows that this text exists and how long it is.",
  },
};

const FALLBACK = {
  fact: "Anything beyond what this record says. A date, a total or a tie shown next to it is not proof of cause or intent.",
  inference: "That the rule's conclusion is certain. It applies a published rule to the records it rests on.",
};

export const claimTable = (id: string) => id.slice(0, id.indexOf("/"));

export function notShown(c: Pick<Claim, "id" | "kind">): string {
  const row = NOT_SHOWN[claimTable(c.id) as TableName];
  return row?.[c.kind] ?? FALLBACK[c.kind];
}

export const ruleId = (c: Pick<Claim, "rule">) => c.rule?.split(":")[0]?.trim() ?? null;

export const ruleUrl = (id: string) => `${RULES_URL}#${id}`;

/** One line beside the FACT / INFERENCE tag: how the claim was made. */
export function provenance(c: Pick<Claim, "kind" | "confidence">): string {
  const conf = `CONFIDENCE ${c.confidence === 1 ? "1.0" : c.confidence.toFixed(2)}`;
  if (c.kind === "inference") return `A RULE APPLIED TO RECORDS · ${conf}`;
  return c.confidence === 1 ? `READ STRAIGHT FROM THE RECORD · ${conf}` : `READ FROM A SCAN OR IMAGE · ${conf}`;
}

export function citation(c: Claim): string {
  return [
    c.text,
    `Source: ${c.sourceUrl}`,
    c.sourceLocator && `Where: ${c.sourceLocator}`,
    c.archiveUrl && `Archived copy: ${c.archiveUrl}`,
    `antibody receipt: ${c.id}`,
  ]
    .filter(Boolean)
    .join("\n");
}
