import type { Bundle } from "@antibody/core";

type Rule = Bundle["rules"][number];

const DOCS = "https://github.com/AVGVSTVS96/antibody/blob/main/docs/rules.md";

/** Rules the bundle builder applies itself. Same text, same thresholds, for every bill and party. */
export const RULES: Record<string, { version: string; text: string }> = {
  "tied-stock": {
    version: "1",
    text: "A company is tied to a bill if it lobbied on the bill (an LD-2 issue line names it) or the bill's text names it.",
  },
  "trade-window": {
    version: "1",
    text: "Trades in a tied company's stock count from one year before the bill was introduced to one year after it became law (or its last dated action).",
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
  "cbo-even-split": {
    version: "1",
    text: "When one CBO line covers several sections, each section is shown an even share of it, labeled an inference: CBO did not split it.",
  },
};

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
  return { id, version: "1", text: text.replace(/^./, (c) => c.toUpperCase()), url: null };
}

export const CBO_EVEN_SPLIT = `cbo-even-split: ${RULES["cbo-even-split"]!.text}`;
