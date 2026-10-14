import type { Bundle } from "@antibody/core";

type Rule = Bundle["rules"][number];

export const DOCS = "https://github.com/AVGVSTVS96/antibody/blob/main/docs/rules.md";

/** Rules the bundle builder applies itself. Same text, same thresholds, for every bill and party. */
export const RULES: Record<string, { version: string; text: string }> = {
  "tied-stock": {
    version: "1",
    text: "A company is tied to a bill if it lobbied on the bill (an LD-2 issue line names it) or the bill's text names it.",
  },
  "trade-window": {
    version: "1",
    text: "Trades in a tied company's stock count from one year before the bill was introduced to one year after it became law (or its last dated action). Routine disclosures; no link to any vote is claimed, and large companies' shares are traded all the time.",
  },
  "affected-donors": {
    version: "1",
    text: "A political committee counts as an affected donor when it resolves to a company tied to the bill.",
  },
  "donor-window": {
    version: "1",
    text: "Donations count in the two-year FEC cycles from the bill's introduction through its enactment (or last dated action).",
  },
  "member-votes": {
    version: "1",
    text: "Each member's vote is shown for passage, concurrence, conference-report and veto-override roll calls; every roll call on the bill is listed with its totals.",
  },
  "lobbyist-nodes": {
    version: "1",
    text: "A lobbyist is drawn when a filing that names the bill lists a covered (former government) position for them, quoted as filed; every lobbyist is counted.",
  },
  "counterpart-ref": {
    version: "1",
    text: "A lobbying filing that names the other chamber's bill, or an earlier version of the same bill, is taken to be about this bill because the texts are the same bill.",
  },
  "lda-topic-only": {
    version: "1",
    text: "An issue line that describes a bill's subject without naming any bill is taken to be about it only as a dashed inference, off by default.",
  },
  "cbo-even-split": {
    version: "1",
    text: "When one CBO line covers several sections, each section is shown an even share of it, labeled an inference: CBO did not split it.",
  },
  "entity-ticker": {
    version: "1",
    text: "A ticker written on a trade disclosure, found in SEC's ticker list under a matching company name, identifies the company.",
  },
  "entity-name": {
    version: "1",
    text: "An organization whose name equals exactly one SEC-listed company's name, after removing legal suffixes and filler words, is taken to be that company.",
  },
  "entity-fuzzy": {
    version: "1",
    text: "An organization whose name is nearly identical to one SEC-listed company's name (token-sort score of 94 or more, 4 points clear of the next, same first word) is taken to be that company.",
  },
  "entity-review": {
    version: "1",
    text: "When names differ, a language model picks the company from SEC candidates and gives its reason; only answers at 0.8 confidence or higher count.",
  },
  "subsidiary-parent": {
    version: "1",
    text: "A subsidiary's lobbying, PAC or stock counts toward its public parent; the subsidiary is named and the reason given.",
  },
  "amendment-text": {
    version: "1",
    text: "A section's wording is in the printed text of the amendment that was agreed to.",
  },
  "amendment-strike": {
    version: "1",
    text: "The amendment strikes the substitute's section that carries this section's heading or wording.",
  },
  "only-agreed-amendment": {
    version: "1",
    text: "The one amendment agreed to between the two versions is the one that changed the section.",
  },
  "last-agreed-substitute": {
    version: "1",
    text: "The last full substitute agreed to between the two versions is the one that changed the section.",
  },
  "llm-counterpart": {
    version: "1",
    text: "A model read both sections and judged that the added one does the same job in law as the removed one, rewritten rather than copied.",
  },
  "cbo-prose-to-section": {
    version: "1",
    text: "A model (named in the evidence) linked this sentence of CBO's estimate to the bill section whose provision it describes; the quote is checked word for word against the cited PDF page.",
  },
  "predecessor-bill": {
    version: "1",
    text: "An earlier bill with the same short title and sponsor whose sections match this bill's first text is its predecessor.",
  },
  "substitute-adds": {
    version: "1",
    text: "A section first seen in the text right after an agreed substitute came in with that substitute.",
  },
};

/** Rules whose full text is written by another stage and travels with each claim; docs/rules.md still explains them. */
export const CLAIM_TEXT_RULES = ["buried-v1", "attention-v1"];

/** `"subsidiary-parent: a subsidiary's lobbying counts…"` or `"tied-stock"` → a published rule entry. */
export function ruleFor(rule: string): Rule {
  const [head, ...rest] = rule.split(":");
  const id = head!
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  const known = RULES[id];
  if (known) return { id, version: known.version, text: known.text, url: `${DOCS}#${id}` };
  const text = rest.join(":").trim() || rule;
  return {
    id,
    version: "1",
    text: text.replace(/^./, (c) => c.toUpperCase()),
    url: CLAIM_TEXT_RULES.includes(id) ? `${DOCS}#${id}` : null,
  };
}

export const CBO_EVEN_SPLIT = `cbo-even-split: ${RULES["cbo-even-split"]!.text}`;
export const COUNTERPART_REF = `counterpart-ref: ${RULES["counterpart-ref"]!.text}`;
