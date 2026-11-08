import { z } from "zod";
import { Claim, ClaimId } from "./claim.ts";
import { Edge, NodeId, nodeId } from "./graph.ts";
import { isRecord, isText } from "./json.ts";
import type { Tree } from "./json.ts";
import { ReachKind } from "./tables.ts";

const date = z.iso.date();
const Party = z.enum(["R", "D", "I"]);
const Chamber = z.enum(["House", "Senate"]);
export const Baseline = z.enum(["current-law", "current-policy"]);

export const Measure = z.enum(["budget_authority", "outlays", "revenues", "deficit", "nonscorable_revenues"]);
export const OutletGroup = z.enum(["left", "center-left", "center", "center-right", "right"]);

export const BillCard = z.object({
  id: z.string(),
  display: z.string(),
  congress: z.number().int(),
  title: z.string(),
  shortTitle: z.string().nullable(),
  sponsor: NodeId.nullable(),
  law: z.string().nullable(),
  lawOn: date.nullable(),
  latestAction: z.string().nullable(),
  lateUnavailable: z.string().nullable().default(null),
  vehicle: z.string().nullable().default(null),
  url: z.url(),
  billstatusUrl: z.url(),
  claims: z.array(ClaimId),
});

export const Version = z.object({
  code: z.string(),
  name: z.string(),
  date: date.nullable(),
  url: z.url(),
  sections: z.number().int(),
  words: z.number().int(),
  predecessor: z.boolean(),
  claim: ClaimId,
});

export const Dollar = z.object({
  estimateId: z.string(),
  baseline: Baseline,
  measure: Measure,
  spending: z.enum(["direct", "discretionary"]).nullable().optional(),
  period: z.string(),
  amountMusd: z.number(),
  split: z.enum(["exact", "even_split"]),
  claim: ClaimId,
});

export type Dollar = z.infer<typeof Dollar>;

export const Estimate = z.object({
  id: z.string(),
  url: z.url(),
  fileUrl: z.url(),
  archiveUrl: z.url().nullable(),
  publishedOn: date.nullable(),
  versionCode: z.string().nullable(),
  versionScored: z.string(),
  baseline: Baseline,
  baselineLabel: z.string(),
  perSection: z.boolean(),
  mandates: z.object({ privateSector: z.string(), intergovernmental: z.string(), claim: ClaimId }).nullable(),
  claim: ClaimId,
});

const Example = z.object({
  url: z.url(),
  outlet: z.string(),
  group: z.string(),
  title: z.string(),
  date: date.nullable(),
  claim: ClaimId,
});

export const SectionAttention = z.object({
  hits: z.number().int(),
  pct: z.number().min(0).max(1).nullable(),
  hitsByGroup: z.partialRecord(OutletGroup, z.number().int()),
  tradeLegalHits: z.number().int(),
  examples: z.array(Example),
  claim: ClaimId,
});

export const Score = z.object({
  label: z.enum(["headline", "buried", "normal"]),
  buried: z.number().nullable(),
  offsets: z.string().nullable().default(null),
  components: z.object({
    dollarsMusd: z.number().nullable(),
    dollarsSplit: z.enum(["exact", "even_split"]).nullable(),
    attentionPct: z.number().nullable(),
    attentionShare: z.number().nullable().default(null),
    attentionChecked: z.number().int().nullable().default(null),
    late: z.boolean(),
    lateClearedBy: z.string().nullable().default(null),
    offTopic: z.number().nullable(),
    lobbyingReports: z.number().int(),
    lobbyingFirms: z.number().int().default(0),
    reach: z.array(ReachKind).default([]),
  }),
  claim: ClaimId,
});

export const Reach = z.object({ kind: ReachKind, quote: z.string(), claim: ClaimId });

export const SectionStep = z.object({
  path: z.string(),
  heading: z.string(),
  words: z.number().int(),
  match: z.string().nullable(),
  similarity: z.number().nullable(),
  wordsAdded: z.number().int().nullable(),
  wordsRemoved: z.number().int().nullable(),
  largestInserts: z.array(z.string()),
});

export const Part = z.object({
  id: z.string(),
  num: z.string(),
  heading: z.string(),
  trail: z.array(z.string()),
  leadIn: z.boolean(),
  words: z.number().int(),
  preview: z.string(),
  firstVersion: z.string(),
  late: z.boolean(),
  textUrl: z.url(),
  attention: SectionAttention.nullable(),
  score: Score.nullable(),
  reach: z.array(Reach).default([]),
  claims: z.array(ClaimId),
});

export type Part = z.infer<typeof Part>;

export const Section = z.object({
  id: z.string(),
  num: z.string(),
  heading: z.string(),
  path: z.string(),
  firstVersion: z.string(),
  inFinal: z.boolean(),
  late: z.boolean(),
  changedIn: z.array(z.string()),
  removedIn: z.string().nullable(),
  revivedIn: z.array(z.string()),
  splitFrom: z.string().nullable(),
  splitInto: z.array(z.string()),
  mergedInto: z.string().nullable(),
  counterpart: z.object({ sectionId: z.string(), claim: ClaimId }).nullable(),
  words: z.number().int(),
  textUrl: z.url(),
  preview: z.string(),
  history: z.record(z.string(), SectionStep),
  dollars: z.array(Dollar),
  attention: SectionAttention.nullable(),
  score: Score.nullable(),
  reach: z.array(Reach).default([]),
  parts: z.array(Part).default([]),
  claims: z.array(ClaimId),
});

export type Section = z.infer<typeof Section>;

export const RollCall = z.object({
  id: z.string(),
  chamber: Chamber,
  number: z.number().int(),
  date,
  question: z.string(),
  result: z.string(),
  yeas: z.number().int(),
  nays: z.number().int(),
  url: z.url(),
  claim: ClaimId,
});

export const Amendment = z.object({
  id: z.string(),
  number: z.string(),
  chamber: Chamber,
  sponsor: NodeId.nullable(),
  purpose: z.string().nullable(),
  status: z.enum(["agreed", "failed", "withdrawn", "no_action", "other"]),
  latestAction: z.string().nullable(),
  latestActionOn: date.nullable(),
  rollId: z.string().nullable(),
  versionStep: z.string().nullable(),
  url: z.url(),
  sections: z.array(z.string()),
  claim: ClaimId,
});

const Quote = z.object({ quote: z.string(), claim: ClaimId });

export const NODE_PROPS = {
  member: z.object({
    bioguide: z.string(),
    party: Party,
    state: z.string(),
    district: z.number().int().nullable(),
    chamber: Chamber,
    paperFilingsUnread: z.boolean(),
  }),
  company: z.object({ cik: z.string(), tickers: z.array(z.string()), secUrl: z.url() }),
  client: z.object({
    names: z.array(z.string()),
    ldaClientIds: z.array(z.string()),
    description: z.string().nullable(),
  }),
  registrant: z.object({ ldaId: z.string() }),
  lobbyist: z.object({ ldaId: z.string(), coveredPositions: z.array(Quote) }),
  committee: z.object({ chamber: z.enum(["House", "Senate", "Joint"]) }),
  pac: z.object({
    fecId: z.string(),
    connectedOrg: z.string().nullable(),
    subsidiaryOf: z.string().nullable().default(null),
  }),
} as const;

export type EntityKind = keyof typeof NODE_PROPS;

const nodeOf = <K extends EntityKind>(kind: K) =>
  z.object({
    id: NodeId,
    kind: z.literal(kind),
    label: z.string(),
    claims: z.array(ClaimId),
    props: NODE_PROPS[kind],
  });

export const Node = z.discriminatedUnion("kind", [
  nodeOf("member"),
  nodeOf("company"),
  nodeOf("client"),
  nodeOf("registrant"),
  nodeOf("lobbyist"),
  nodeOf("committee"),
  nodeOf("pac"),
]);

export type Node = z.infer<typeof Node>;

export type NodeOf<K extends EntityKind> = Extract<Node, { kind: K }>;

export const Gap = z.object({
  id: z.string(),
  kind: z.enum([
    "paper_filings_unread",
    "no_section_dollars",
    "attention_partial",
    "entity_recall",
    "late_unavailable",
    "other",
  ]),
  text: z.string(),
  nodes: z.array(NodeId),
  claim: ClaimId.nullable(),
});

export const Rule = z.object({ id: z.string(), version: z.string(), text: z.string(), url: z.url().nullable() });

export const Bundle = z.object({
  schema: z.literal(1),
  generatedAt: z.iso.datetime({ offset: true }),
  bill: BillCard,
  versions: z.array(Version),
  sections: z.array(Section),
  votes: z.array(RollCall),
  amendments: z.array(Amendment),
  dollars: z.object({ estimates: z.array(Estimate), wholeBill: z.array(Dollar) }),
  attention: z.object({
    via: z.array(z.enum(["mediacloud", "gnews"])),
    outletListVersion: z.string().nullable(),
    window: z.tuple([date, date]).nullable(),
    articles: z.number().int(),
    sample: z.object({ found: z.number().int(), relevant: z.number().int() }).nullable().default(null),
    general: SectionAttention.nullable(),
  }),
  lobbying: z.object({
    reports: z.number().int(),
    clients: z.number().int(),
    registrants: z.number().int(),
    lobbyists: z.number().int(),
    byPhase: z.object({ bill: z.number(), enactmentQuarter: z.number(), law: z.number() }),
    spendTotalUsd: z.number().nullable(),
    shareEstimateUsd: z.number().nullable(),
    claims: z.array(ClaimId),
  }),
  nodes: z.array(Node),
  edges: z.array(Edge),
  claims: z.record(ClaimId, Claim),
  gaps: z.array(Gap),
  paperUnread: z
    .object({ R: z.number().int(), D: z.number().int(), I: z.number().int() })
    .default({ R: 0, D: 0, I: 0 }),
  rules: z.array(Rule),
});

export type Bundle = z.infer<typeof Bundle>;

export const BillStats = z.object({
  sections: z.number().int(),
  headline: z.number().int(),
  buried: z.number().int(),
  buriedParts: z.number().int().default(0),
  late: z.number().int().nullable(),
  tally: z
    .object({
      chamber: z.string(),
      date,
      yeas: z.number().int(),
      nays: z.number().int(),
      result: z.string(),
      byParty: z
        .partialRecord(Party, z.object({ yea: z.number().int(), nay: z.number().int() }))
        .nullable()
        .default(null),
    })
    .nullable()
    .default(null),
  lobbyingReports: z.number().int(),
  companies: z.number().int(),
  membersTraded: z.number().int(),
  membersTradedDuring: z.number().int().default(0),
  buriedTest: z
    .object({
      tested: z.boolean(),
      why: z.string().nullable(),
      bigStakes: z.number().int(),
      dollarsMeasured: z.boolean().default(true),
      costMeasured: z.number().int().default(0),
      reach: z.number().int().default(0),
    })
    .default({ tested: true, why: null, bigStakes: 0, dollarsMeasured: true, costMeasured: 0, reach: 0 }),
  cboPublished: z.boolean().default(false),
  deficitDirectOnly: z.boolean().default(false),
  tradeSpan: z.tuple([date, date]).nullable().default(null),
  lateShare: z.number().nullable().default(null),
  vehicle: z.boolean().default(false),
  deficitMusd: z.number().nullable(),
  fingerprint: z.string().regex(/^[hbnu]*$/u),
});

export const WatchPick = z.object({
  billId: z.string(),
  display: z.string(),
  title: z.string(),
  kind: z.enum(["new_version", "enrolled", "new_bill", "floor_vote", "action", "cbo_estimate", "hot"]),
  seenAt: z.iso.datetime({ offset: true }),
  url: z.url(),
  reason: z.string().nullable(),
  sponsorParty: Party.nullable(),
  file: z.string().nullable(),
});

export const BundleIndex = z.object({
  generatedAt: z.iso.datetime({ offset: true }),
  bills: z.array(
    z.object({
      id: z.string(),
      display: z.string(),
      title: z.string(),
      shortTitle: z.string().nullable(),
      law: z.string().nullable(),
      sponsorParty: Party.nullable(),
      congress: z.number().int().default(0),
      latestActionOn: date.nullable(),
      file: z.string(),
      claimsFile: z.string().nullable().default(null),
      stats: BillStats.nullable().default(null),
      origin: z.enum(["curated", "watcher"]).default("curated"),
      note: z.string().nullable().default(null),
      addedOn: date.nullable().default(null),
    }),
  ),
  watch: z.array(WatchPick).default([]),
});

export type BundleIndex = z.infer<typeof BundleIndex>;

export function checkBundle(b: Bundle): string[] {
  const problems: string[] = [];

  const ids = new Set<string>([
    nodeId("bill", b.bill.id),
    ...b.sections.map((s) => nodeId("section", s.id)),
    ...b.nodes.map((n) => n.id),
  ]);

  for (const e of b.edges) {
    if (!ids.has(e.src)) {
      problems.push(`edge ${e.id}: unknown src ${e.src}`);
    }

    if (!ids.has(e.dst)) {
      problems.push(`edge ${e.id}: unknown dst ${e.dst}`);
    }
  }

  const walk = (v: Tree, path: string) => {
    if (Array.isArray(v)) {
      for (const [i, x] of v.entries()) {
        walk(x, `${path}[${i}]`);
      }
    } else if (isRecord(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (path === "" && k === "claims") {
          continue;
        }

        if (
          (k === "claim" || k === "claims" || k === "restsOn" || k.endsWith("Claim")) &&
          x !== null &&
          x !== undefined
        ) {
          for (const id of [x].flat()) {
            if (!isText(id) || !(id in b.claims)) {
              problems.push(`${path}.${k}: unknown claim ${isText(id) ? id : JSON.stringify(id)}`);
            }
          }
        }

        walk(x, `${path}.${k}`);
      }
    }
  };

  walk(b, "");
  const sectionIds = new Set(b.sections.map((s) => s.id));

  for (const s of b.sections) {
    const offsets = s.score?.offsets;

    if (offsets !== undefined && offsets !== null && offsets !== "" && !sectionIds.has(offsets)) {
      problems.push(`section ${s.id}: offsets unknown section ${offsets}`);
    }
  }

  for (const c of Object.values(b.claims)) {
    for (const id of c.restsOn) {
      if (!(id in b.claims)) {
        problems.push(`claims.${c.id}.restsOn: unknown claim ${id}`);
      }
    }
  }

  return problems;
}

const years = (period: string) => {
  const [from, to] = period.split("-").map(Number);

  return (to ?? from ?? 0) - (from ?? 0);
};

export function headlineDeficit(b: Bundle, baseline: Dollar["baseline"]): Dollar | undefined {
  const published = new Map(b.dollars.estimates.map((e) => [e.id, e.publishedOn]));

  return b.dollars.wholeBill
    .filter((d) => d.measure === "deficit" && d.baseline === baseline)
    .toSorted(
      (x, y) =>
        (published.get(y.estimateId) ?? "").localeCompare(published.get(x.estimateId) ?? "") ||
        y.estimateId.localeCompare(x.estimateId) ||
        years(y.period) - years(x.period),
    )[0];
}

function finalVote(b: Bundle) {
  const voted = new Set(
    b.edges.filter((e) => e.kind === "voted").map((e) => (e.kind === "voted" ? e.props.rollId : "")),
  );

  const roll = b.votes
    .filter((v) => voted.has(v.id))
    .toSorted((x, y) => x.date.localeCompare(y.date) || x.number - y.number)
    .at(-1);

  if (!roll) {
    return null;
  }

  const party = new Map(b.nodes.flatMap((n) => (n.kind === "member" ? [[n.id, n.props.party] as const] : [])));
  const byParty: Partial<Record<"R" | "D" | "I", { yea: number; nay: number }>> = {};

  for (const e of b.edges) {
    if (e.kind !== "voted" || e.props.rollId !== roll.id || (e.props.vote !== "Yea" && e.props.vote !== "Nay")) {
      continue;
    }

    const p = party.get(e.src);

    if (!p) {
      continue;
    }

    const c = byParty[p] ?? { yea: 0, nay: 0 };
    byParty[p] = c;
    c[e.props.vote === "Yea" ? "yea" : "nay"]++;
  }

  return {
    chamber: roll.chamber,
    date: roll.date,
    yeas: roll.yeas,
    nays: roll.nays,
    result: roll.result,
    byParty: Object.keys(byParty).length ? byParty : null,
  };
}

export const BIG_STAKES = { dollarsMusd: 10_000, firms: 21 };

export const MIN_SECTIONS_TO_BURY = 10;

export const bigStakes = (c: { dollarsMusd: number | null; dollarsSplit: string | null; lobbyingFirms: number }) =>
  (c.dollarsMusd !== null && c.dollarsSplit !== "even_split" && Math.abs(c.dollarsMusd) >= BIG_STAKES.dollarsMusd) ||
  c.lobbyingFirms >= BIG_STAKES.firms;

export const REACH_WORDS: Record<ReachKind, string> = {
  courts: "limits courts",
  states: "overrides state law",
  lawsuit: "opens lawsuits",
  review: "skips public review",
  rule: "blocks a rule",
};

export function buriedWords(score: z.infer<typeof Score>): string {
  const c = score.components;

  return bigStakes(c) || !c.reach.length
    ? "quiet and costly"
    : `quiet, ${c.reach.map((k) => REACH_WORDS[k]).join(", ")}`;
}

export const isLate = (s: Pick<Section, "late" | "score">) => s.score?.components.late ?? s.late;

export const articlesOf = (s: Pick<Section, "attention" | "score">) =>
  s.attention === null ? null : s.attention.hits + (s.score?.components.attentionChecked ?? 0);

export function activeSpan(b: Bundle): [string, string] | null {
  const own = b.versions.flatMap((v) => (!v.predecessor && v.date !== null && v.date !== "" ? [v.date] : []));
  const start = own.toSorted()[0];

  const end =
    b.bill.lawOn ??
    [...b.votes.map((v) => v.date), ...b.versions.map((v) => v.date)]
      .filter((d): d is string => d !== null && d !== "")
      .toSorted()
      .at(-1);

  return start === undefined || end === undefined || end === null || end === "" ? null : [start, end];
}

export const isAppropriations = (b: Bundle) => /appropriations/iu.test(`${b.bill.title} ${b.bill.shortTitle ?? ""}`);

export function billStats(b: Bundle): z.infer<typeof BillStats> {
  const final = b.sections.filter((s) => s.inFinal);
  const deficit = headlineDeficit(b, "current-law");
  const traders = b.edges.filter((e) => e.kind === "traded");
  const span = activeSpan(b);

  const during = new Set(
    span
      ? traders
          .filter((e) => e.kind === "traded" && e.props.events.some((ev) => ev.date >= span[0] && ev.date <= span[1]))
          .map((e) => e.src)
      : [],
  );

  const ranked = final.some((s) => (s.attention?.pct ?? null) !== null);

  const priced = final.filter(
    (s) => (s.score?.components.dollarsMusd ?? null) !== null && s.score?.components.dollarsSplit !== "even_split",
  ).length;

  const dollarsMeasured = priced > 0;
  const big = final.filter((s) => s.score !== null && bigStakes(s.score.components)).length;
  const reach = final.filter((s) => (s.score?.components.reach.length ?? 0) > 0).length;

  const why =
    final.length < MIN_SECTIONS_TO_BURY
      ? `the bill has only ${final.length} ${final.length === 1 ? "section" : "sections"}, too few for anything to be buried among`
      : ranked
        ? !dollarsMeasured && !big && !reach
          ? "CBO gave no section its own dollar figure, no section is named in enough lobbying reports, and no section's text has reach, so no section's stakes are known"
          : null
        : "too few news articles to rank this bill's sections";

  return {
    sections: final.length,
    headline: final.filter((s) => s.score?.label === "headline").length,
    buried: final.filter((s) => s.score?.label === "buried").length,
    buriedParts: final
      .filter((s) => s.score?.label !== "buried")
      .reduce((n, s) => n + (s.parts ?? []).filter((p) => p.score?.label === "buried").length, 0),
    late: b.bill.lateUnavailable !== null && b.bill.lateUnavailable !== "" ? null : final.filter(isLate).length,
    tally: finalVote(b),
    lobbyingReports: b.lobbying.reports,
    companies: new Set(b.edges.filter((e) => e.kind === "benefits").map((e) => e.dst)).size,
    membersTraded: new Set(traders.map((e) => e.src)).size,
    membersTradedDuring: during.size,
    buriedTest: { tested: why === null, why, bigStakes: big, dollarsMeasured, costMeasured: priced, reach },
    cboPublished: b.dollars.estimates.length > 0,
    deficitDirectOnly: isAppropriations(b) && deficit !== undefined,
    tradeSpan: span,
    lateShare:
      (b.bill.lateUnavailable !== null && b.bill.lateUnavailable !== "") || !final.length
        ? null
        : final.filter(isLate).length / final.length,
    vehicle: b.bill.vehicle !== null && b.bill.vehicle !== "",
    deficitMusd: deficit?.amountMusd ?? null,
    fingerprint: final.map((s) => (s.score ? s.score.label[0] : "u")).join(""),
  };
}
