import type { Row } from "@antibody/core";
import { filled } from "@antibody/core";
import { resolveMention } from "./match.ts";
import type { CompanyIndex, Evidence, Match, Mention, Outcome } from "./match.ts";
import { dedupe, uniqueBySrc } from "./mentions.ts";
import { review } from "./review.ts";
import type { ReviewStats } from "./review.ts";
import { RULE_FOR } from "./rules.ts";

export type { Queued } from "./match.ts";

export interface Resolved {
  rows: Row<"resolutions">[];
  outcomes: {
    mention: Mention;
    outcome: Outcome | { kind: "rejected"; why: string };
    match: Match | null;
    count: number;
  }[];
  review: ReviewStats | null;
}

export async function resolveAll(
  mentions: Mention[],
  index: CompanyIndex,
  opts: { log: (m: string) => void; signal?: AbortSignal; llm?: boolean },
): Promise<Resolved> {
  const { unique, fanOut } = dedupe(uniqueBySrc(mentions));
  const first = unique.map((m) => ({ m, o: resolveMention(m, index) }));
  const queued = first.flatMap(({ o }) => (o.kind === "queue" ? [o.queued] : []));
  const reviewed = opts.llm === false ? null : await review(queued, index, opts);
  const byMention = new Map<Mention, Match>();

  for (const { m, o } of first) {
    if (o.kind === "match") {
      byMention.set(m, o.match);
    }
  }

  for (const x of reviewed?.matches ?? []) {
    byMention.set(x.mention, x);
  }

  const rejected = new Map<Mention, string>((reviewed?.rejected ?? []).map((r) => [r.q.mention, r.why]));

  const rows: Row<"resolutions">[] = [];

  for (const [rep, match] of byMention) {
    for (const m of fanOut.get(rep) ?? [rep]) {
      rows.push(toRow({ ...match, mention: m }));
    }
  }

  const outcomes = first.map(({ m, o }) => {
    const why = rejected.get(m);

    return {
      mention: m,
      outcome: why === undefined ? o : { kind: "rejected" as const, why },
      match: byMention.get(m) ?? null,
      count: fanOut.get(m)?.length ?? 1,
    };
  });

  return { rows, outcomes, review: reviewed?.stats ?? null };
}

function toRow(x: Match): Row<"resolutions"> {
  const evidence: Evidence = { name: x.mention.name };

  if (filled(x.mention.ticker)) {
    evidence.filedTicker = x.mention.ticker;
  }

  return {
    id: x.mention.src,
    src: x.mention.src,
    company_id: x.cik,
    method: x.method,
    rule: RULE_FOR[x.method],
    confidence: x.confidence,
    rests_on: [...x.mention.restsOn, `companies/${x.cik}`],
    evidence: { ...evidence, ...x.evidence },
  };
}
