import type { Stage } from "@antibody/core";
import { runLobbying } from "./lobbying.ts";
import { runTopic } from "./topic.ts";

export { RULES } from "./spend.ts";

export const stages: Stage[] = [
  {
    name: "lobbying",
    scope: "bill",
    needs: [],
    writes: ["lda_filings", "lda_clients", "lda_bill_refs", "lda_lobbyists", "lda_spend"],
    run: runLobbying,
  },
  {
    name: "lobbying-topic",
    scope: "bill",
    needs: ["lobbying"],
    writes: ["lda_filings", "lda_clients", "lda_topic_refs", "lda_spend"],
    run: runTopic,
  },
];
