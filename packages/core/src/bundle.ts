import { z } from "zod";
import { Claim, ClaimId } from "./claim.ts";
import { Edge, NodeId, nodeId } from "./graph.ts";

/**
 * The per-bill Bundle: everything the web app renders for one bill, written by @antibody/store to
 * `data/bundles/<billId>.json` (published copies: `apps/web/public/bundles/`). Every statement points
 * at claims in `claims`; the UI shows each claim's source chip, and inferences dashed with an "inference" pill.
 * Field names are camelCase here; table rows are snake_case.
 */

const date = z.iso.date();
const Party = z.enum(["R", "D", "I"]);
const Chamber = z.enum(["House", "Senate"]);
export const Baseline = z.enum(["current-law", "current-policy"]);
export const Measure = z.enum(["budget_authority", "outlays", "revenues", "deficit"]);
export const OutletGroup = z.enum(["left", "center-left", "center", "center-right", "right", "wire", "tv"]);

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
  /** A predecessor bill's text shown as an earlier stage: an inference. */
  predecessor: z.boolean(),
  claim: ClaimId,
});

export const Dollar = z.object({
  estimateId: z.string(),
  baseline: Baseline,
  measure: Measure,
  period: z.string(),
  /** $ millions, signed as CBO prints it; deficit positive = adds to the deficit. */
  amountMusd: z.number(),
  /** even_split dollars are an inference (a CBO group line divided over its sections). */
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
  /** Named on every number, e.g. "CBO January 2025 baseline". */
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
  /** Percentile within this bill, 0..1. Counted outlets only; trade/legal coverage is kept apart. */
  pct: z.number().min(0).max(1).nullable(),
  hitsByGroup: z.partialRecord(OutletGroup, z.number().int()),
  tradeLegalHits: z.number().int(),
  examples: z.array(Example),
  claim: ClaimId,
});

export const Score = z.object({
  label: z.enum(["headline", "buried", "normal"]),
  buried: z.number().nullable(),
  /** Sub-scores are always shown next to the label, never just a verdict. */
  components: z.object({
    dollarsMusd: z.number().nullable(),
    dollarsSplit: z.enum(["exact", "even_split"]).nullable(),
    attentionPct: z.number().nullable(),
    late: z.boolean(),
    offTopic: z.number().nullable(),
    lobbyingReports: z.number().int(),
  }),
  claim: ClaimId,
});

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

export const Section = z.object({
  /** Lineage id `<billId>@<first version>:<path>`; its node id is `section:<id>`. */
  id: z.string(),
  num: z.string(),
  heading: z.string(),
  path: z.string(),
  firstVersion: z.string(),
  inFinal: z.boolean(),
  /** From the bills lineage: first appears after the first chamber-passed text and wasn't split out of an older section. */
  late: z.boolean(),
  changedIn: z.array(z.string()),
  removedIn: z.string().nullable(),
  revivedIn: z.array(z.string()),
  splitFrom: z.string().nullable(),
  splitInto: z.array(z.string()),
  mergedInto: z.string().nullable(),
  /** LLM-paired functional rewrite (inference). */
  counterpart: z.object({ sectionId: z.string(), claim: ClaimId }).nullable(),
  words: z.number().int(),
  textUrl: z.url(),
  preview: z.string(),
  history: z.record(z.string(), SectionStep),
  dollars: z.array(Dollar),
  attention: SectionAttention.nullable(),
  score: Score.nullable(),
  claims: z.array(ClaimId),
});
export type Section = z.infer<typeof Section>;

export const RollCall = z.object({
  id: z.string(),
  chamber: Chamber,
  number: z.number().int(),
  date: date,
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
  /** Section ids it added or rewrote. */
  sections: z.array(z.string()),
  claim: ClaimId,
});

const Quote = z.object({ quote: z.string(), claim: ClaimId });

/** Entity node props, per kind. Bill and section endpoints of edges resolve to `bundle.bill` / `bundle.sections`. */
export const NODE_PROPS = {
  member: z.object({
    bioguide: z.string(),
    party: Party,
    state: z.string(),
    district: z.number().int().nullable(),
    chamber: Chamber,
    /** Shown next to every member list until the vision step has read this member's paper filings. */
    paperFilingsUnread: z.boolean(),
  }),
  company: z.object({ cik: z.string(), tickers: z.array(z.string()), secUrl: z.url() }),
  client: z.object({
    names: z.array(z.string()),
    ldaClientIds: z.array(z.string()),
    description: z.string().nullable(),
  }),
  registrant: z.object({ ldaId: z.string() }),
  /** Former government positions quoted exactly from the filing. */
  lobbyist: z.object({ ldaId: z.string(), coveredPositions: z.array(Quote) }),
  committee: z.object({ chamber: z.enum(["House", "Senate", "Joint"]) }),
  pac: z.object({ fecId: z.string(), connectedOrg: z.string().nullable() }),
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
  kind: z.enum(["paper_filings_unread", "no_section_dollars", "attention_partial", "entity_recall", "other"]),
  /** Plain sentence shown where the missing data would be. */
  text: z.string(),
  nodes: z.array(NodeId),
  claim: ClaimId.nullable(),
});

/** A published rule (threshold, outlet list, tied-stock rule): one text, applied the same to every bill and party. */
export const Rule = z.object({ id: z.string(), version: z.string(), text: z.string(), url: z.url().nullable() });

export const Bundle = z.object({
  schema: z.literal(1),
  generatedAt: z.iso.datetime({ offset: true }),
  bill: BillCard,
  versions: z.array(Version),
  /** Every section ever seen, final or removed, with lineage, dollars, attention and score. */
  sections: z.array(Section),
  votes: z.array(RollCall),
  /** Agreed, failed and never-voted amendments: the lane for fights outside the bill text. */
  amendments: z.array(Amendment),
  dollars: z.object({ estimates: z.array(Estimate), wholeBill: z.array(Dollar) }),
  attention: z.object({
    via: z.array(z.enum(["mediacloud", "gnews"])),
    outletListVersion: z.string().nullable(),
    window: z.tuple([date, date]).nullable(),
    articles: z.number().int(),
    /** Coverage about the bill as a whole or about things outside its text. */
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
  rules: z.array(Rule),
});
export type Bundle = z.infer<typeof Bundle>;

/** Counts shown on the index card, read from the bundle so the index never needs the bundle itself. */
export const BillStats = z.object({
  sections: z.number().int(),
  headline: z.number().int(),
  buried: z.number().int(),
  late: z.number().int(),
  lobbyingReports: z.number().int(),
  companies: z.number().int(),
  membersTraded: z.number().int(),
  deficitMusd: z.number().nullable(),
  /** One letter per final section in order: h headline, b buried, n normal, u unscored. Drawn as the card's ring. */
  fingerprint: z.string().regex(/^[hbnu]*$/),
});

/** A bill the daily watcher flagged (from `watch_events`), x-rayed or not yet. */
export const WatchPick = z.object({
  billId: z.string(),
  display: z.string(),
  title: z.string(),
  kind: z.enum(["new_version", "enrolled", "new_bill", "hot"]),
  seenAt: z.iso.datetime({ offset: true }),
  url: z.url(),
  /** One plain sentence: why the watcher picked it. */
  reason: z.string().nullable(),
  sponsorParty: Party.nullable(),
  /** Set when a bundle exists for it. */
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
      latestActionOn: date.nullable(),
      file: z.string(),
      stats: BillStats.nullable().default(null),
    }),
  ),
  watch: z.array(WatchPick).default([]),
});
export type BundleIndex = z.infer<typeof BundleIndex>;

/**
 * Checks what zod can't: every claim id referenced anywhere exists in `claims`, every edge endpoint resolves,
 * and every claim's restsOn resolves. Returns the problems (empty = sound).
 */
export function checkBundle(b: Bundle): string[] {
  const problems: string[] = [];
  const ids = new Set<string>([
    nodeId("bill", b.bill.id),
    ...b.sections.map((s) => nodeId("section", s.id)),
    ...b.nodes.map((n) => n.id),
  ]);
  for (const e of b.edges) {
    if (!ids.has(e.src)) problems.push(`edge ${e.id}: unknown src ${e.src}`);
    if (!ids.has(e.dst)) problems.push(`edge ${e.id}: unknown dst ${e.dst}`);
  }
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) {
      for (const [i, x] of v.entries()) walk(x, `${path}[${i}]`);
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (path === "" && k === "claims") continue;
        if ((k === "claim" || k === "claims" || k === "restsOn") && x != null)
          for (const id of [x].flat() as string[])
            if (!(id in b.claims)) problems.push(`${path}.${k}: unknown claim ${id}`);
        walk(x, `${path}.${k}`);
      }
    }
  };
  walk(b, "");
  for (const c of Object.values(b.claims))
    for (const id of c.restsOn) if (!(id in b.claims)) problems.push(`claims.${c.id}.restsOn: unknown claim ${id}`);
  return problems;
}

/** The index card counts for one bundle; store calls this when it writes index.json. */
export function billStats(b: Bundle): z.infer<typeof BillStats> {
  const final = b.sections.filter((s) => s.inFinal);
  const deficit = b.dollars.wholeBill.find((d) => d.measure === "deficit" && d.baseline === "current-law");
  return {
    sections: final.length,
    headline: final.filter((s) => s.score?.label === "headline").length,
    buried: final.filter((s) => s.score?.label === "buried").length,
    late: final.filter((s) => s.late).length,
    lobbyingReports: b.lobbying.reports,
    companies: b.nodes.filter((n) => n.kind === "company").length,
    membersTraded: new Set(b.edges.filter((e) => e.kind === "traded").map((e) => e.src)).size,
    deficitMusd: deficit?.amountMusd ?? null,
    fingerprint: final.map((s) => (s.score ? s.score.label[0] : "u")).join(""),
  };
}
