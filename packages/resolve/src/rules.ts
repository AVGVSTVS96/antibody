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
    id: "entity-alias",
    version: "1",
    text: "A few listed companies are filed under a different name than SEC lists them by (a renamed company, or a holding company that took over the listing). A hand-checked table maps the name to the SEC filer, with the reason.",
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
    text: "A subsidiary's lobbying or PAC counts toward its public parent from the date the parent owned it; the subsidiary is named and the reason given. A subsidiary's PAC counts only when that subsidiary itself lobbied on the bill.",
    url: null,
  },
  {
    id: "tied-stock",
    version: "1",
    text: "A stock is tied to a bill if the company lobbied on it (LD-2). A subsidiary's lobbying counts only for filings made after the parent owned it.",
    url: null,
  },
] as const;

export type RuleId = (typeof RULES)[number]["id"];

export const RULE_FOR: Record<Method, RuleId> = {
  ticker: "entity-ticker",
  name_exact: "entity-name",
  fuzzy: "entity-fuzzy",
  alias: "entity-alias",
  llm_same: "entity-review",
  llm_subsidiary: "subsidiary-parent",
  llm_parent: "subsidiary-parent",
};
