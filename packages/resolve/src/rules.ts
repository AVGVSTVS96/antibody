import type { Method } from "./match.ts";

/** The published rules behind every resolve inference. Rows carry the rule id; store puts these in bundle.rules. */
export const RULES = [
  {
    id: "entity-ticker",
    version: "1",
    text: "A ticker written on a trade disclosure, found in SEC's ticker list under a matching company name, identifies the company.",
    url: null,
  },
  {
    id: "entity-name",
    version: "1",
    text: "An organization whose name equals exactly one SEC-listed company's name, after removing legal suffixes and filler words, is taken to be that company.",
    url: null,
  },
  {
    id: "entity-fuzzy",
    version: "1",
    text: "An organization whose name is nearly identical to one SEC-listed company's name (token-sort score of 94 or more, 4 points clear of the next, same first word) is taken to be that company.",
    url: null,
  },
  {
    id: "entity-review",
    version: "1",
    text: "When names differ, a language model picks the company from SEC candidates and gives its reason; only answers at 0.8 confidence or higher count.",
    url: null,
  },
  {
    id: "subsidiary-parent",
    version: "1",
    text: "A subsidiary's lobbying, PAC or stock counts toward its public parent; the subsidiary is named and the reason given.",
    url: null,
  },
  {
    id: "tied-stock",
    version: "1",
    text: "A stock is tied to a bill if the company lobbied on it (LD-2) or is named in its text.",
    url: null,
  },
] as const;

export type RuleId = (typeof RULES)[number]["id"];

export const RULE_FOR: Record<Method, RuleId> = {
  ticker: "entity-ticker",
  name_exact: "entity-name",
  fuzzy: "entity-fuzzy",
  llm_same: "entity-review",
  llm_subsidiary: "subsidiary-parent",
  llm_parent: "subsidiary-parent",
};
