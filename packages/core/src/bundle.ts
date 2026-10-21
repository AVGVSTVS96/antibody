import { z } from "zod";
import { Claim, ClaimId } from "./claim.ts";
import { Edge, NodeId, nodeId } from "./graph.ts";
import { ReachKind } from "./tables.ts";

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
/** nonscorable_revenues is CBO's memorandum line (revenues it expects but does not score); it is never part of the deficit. */
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
  /** Why "added late" is withheld for this bill (it began as a shell or was rewritten wholesale); null when late flags stand. */
  lateUnavailable: z.string().nullable().default(null),
  /** Set when the law's text came from later versions, not the sponsor's original bill: the sponsor line reads as a vehicle. */
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
  /** A predecessor bill's text shown as an earlier stage: an inference. */
  predecessor: z.boolean(),
  claim: ClaimId,
});

export const Dollar = z.object({
  estimateId: z.string(),
  baseline: Baseline,
  measure: Measure,
  /** direct (mandatory) or discretionary (subject to appropriation); absent for revenues and deficit. */
  spending: z.enum(["direct", "discretionary"]).nullable().optional(),
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
  /** The section this one pays for (CBO prints exactly the opposite figure for both in the same title); an offset is not flagged on its own. */
  offsets: z.string().nullable().default(null),
  /** Sub-scores are always shown next to the label, never just a verdict. */
  components: z.object({
    dollarsMusd: z.number().nullable(),
    dollarsSplit: z.enum(["exact", "even_split"]).nullable(),
    attentionPct: z.number().nullable(),
    /** Share of the bill's relevant articles that discuss the section (sides weighted equally); the buried label needs it under 1%. */
    attentionShare: z.number().nullable().default(null),
    /** Articles a second look found that the section matcher had missed; null when the section was not given one. */
    attentionChecked: z.number().int().nullable().default(null),
    /** Late after the counterpart check; the section's own `late` is the lineage fact. */
    late: z.boolean(),
    /** The older section whose model-paired counterpart cleared `late`. */
    lateClearedBy: z.string().nullable().default(null),
    offTopic: z.number().nullable(),
    /** Reports that name the section, each filing once. */
    lobbyingReports: z.number().int(),
    /** Distinct lobbying firms behind those reports: what stakes count. */
    lobbyingFirms: z.number().int().default(0),
    /** Kinds of reach the section's text has; any one counts as big stakes. */
    reach: z.array(ReachKind).default([]),
  }),
  claim: ClaimId,
});

/** Wording in a section's text that reaches past its price (reach-v2), quoted from the text it was last seen in: a fact. */
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

export const Section = z.object({
  /** Lineage id `<billId>@<first version>:<path>`; its node id is `section:<id>`. */
  id: z.string(),
  num: z.string(),
  heading: z.string(),
  path: z.string(),
  firstVersion: z.string(),
  inFinal: z.boolean(),
  /** From the bills lineage, a fact: first appears after the first chamber-passed text and wasn't split out of an older section. Use `isLate` for the flag the page shows. */
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
  /** Reach tags, removed sections included, so a page can say what a dropped provision did. */
  reach: z.array(Reach).default([]),
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
  /** `subsidiary` is the company (CIK) whose subsidiary's committee this is, when it is not the company's own PAC. */
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
    /** Articles found for the bill, and how many of the ones read were judged to be about it: the sample section counts come from. */
    sample: z.object({ found: z.number().int(), relevant: z.number().int() }).nullable().default(null),
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
  /** Members whose paper trade filings in the bill's window are unread, by party: counts everyone, drawn in the graph or not. */
  paperUnread: z
    .object({ R: z.number().int(), D: z.number().int(), I: z.number().int() })
    .default({ R: 0, D: 0, I: 0 }),
  rules: z.array(Rule),
});
export type Bundle = z.infer<typeof Bundle>;

/** Counts shown on the index card, read from the bundle so the index never needs the bundle itself. */
export const BillStats = z.object({
  sections: z.number().int(),
  headline: z.number().int(),
  buried: z.number().int(),
  /** Null when the bill began as a shell, so "added late" cannot be told. */
  late: z.number().int().nullable(),
  /** The last roll call members' votes are drawn for, so the card can say how it ended. */
  tally: z
    .object({
      chamber: z.string(),
      date,
      yeas: z.number().int(),
      nays: z.number().int(),
      result: z.string(),
      /** Yea and Nay votes by party among the members drawn; null when the votes are not drawn per member. */
      byParty: z
        .partialRecord(Party, z.object({ yea: z.number().int(), nay: z.number().int() }))
        .nullable()
        .default(null),
    })
    .nullable()
    .default(null),
  lobbyingReports: z.number().int(),
  /** Companies tied to the bill: the ones with a `benefits` edge, the count the page headlines. */
  companies: z.number().int(),
  membersTraded: z.number().int(),
  /** Of those, members with a trade dated from the first text through signing (or the last dated action). */
  membersTradedDuring: z.number().int().default(0),
  /**
   * Whether the buried label could be tested on this bill, and how many sections had stakes big enough to qualify.
   * `tested` is false when the rule cannot fire: the bill is too short to bury anything, there are too few articles to
   * rank its sections, or no section has a measured cost (CBO gave none its own figure and no section is named in
   * enough lobbying reports). `dollarsMeasured` is false when CBO gave no section its own figure, so only lobbying can
   * show big stakes and "none have big stakes" would only mean "not measured".
   */
  buriedTest: z
    .object({
      tested: z.boolean(),
      why: z.string().nullable(),
      bigStakes: z.number().int(),
      dollarsMeasured: z.boolean().default(true),
      /** Final sections CBO gave their own figure: the sections the cost half of the test could look at. */
      costMeasured: z.number().int().default(0),
      /** Final sections whose text has reach: big stakes without a price. */
      reach: z.number().int().default(0),
    })
    .default({ tested: true, why: null, bigStakes: 0, dollarsMeasured: true, costMeasured: 0, reach: 0 }),
  /** CBO published at least one estimate for the bill (a whole-bill deficit may still be unread). */
  cboPublished: z.boolean().default(false),
  /** The headline deficit covers only direct spending and revenue; the bill's discretionary appropriations are not in it. */
  deficitDirectOnly: z.boolean().default(false),
  /** Trade dates counted in `membersTradedDuring`: first text through signing. */
  tradeSpan: z.tuple([date, date]).nullable().default(null),
  /** Share of final sections that arrived late; late counts for nothing at or above the score's late cutoff. */
  lateShare: z.number().nullable().default(null),
  vehicle: z.boolean().default(false),
  deficitMusd: z.number().nullable(),
  /** One letter per final section in order: h headline, b buried, n normal, u unscored. Drawn as the card's ring. */
  fingerprint: z.string().regex(/^[hbnu]*$/),
});

/** A bill the daily watcher flagged (from `watch_events`), x-rayed or not yet. */
export const WatchPick = z.object({
  billId: z.string(),
  display: z.string(),
  title: z.string(),
  kind: z.enum(["new_version", "enrolled", "new_bill", "floor_vote", "action", "cbo_estimate", "hot"]),
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
      congress: z.number().int().default(0),
      latestActionOn: date.nullable(),
      file: z.string(),
      claimsFile: z.string().nullable().default(null),
      stats: BillStats.nullable().default(null),
      /** Curated bills were hand-checked; watcher bills were added by the daily watcher as it found them. */
      origin: z.enum(["curated", "watcher"]).default("curated"),
      /** One plain sentence on what is thinner than a curated bill. Set only when `origin` is watcher. */
      note: z.string().nullable().default(null),
      /** The day the watcher added it, YYYY-MM-DD. Null for curated bills. */
      addedOn: date.nullable().default(null),
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
        if ((k === "claim" || k === "claims" || k === "restsOn" || k.endsWith("Claim")) && x != null)
          for (const id of [x].flat() as string[])
            if (!(id in b.claims)) problems.push(`${path}.${k}: unknown claim ${id}`);
        walk(x, `${path}.${k}`);
      }
    }
  };
  walk(b, "");
  const sectionIds = new Set(b.sections.map((s) => s.id));
  for (const s of b.sections)
    if (s.score?.offsets && !sectionIds.has(s.score.offsets))
      problems.push(`section ${s.id}: offsets unknown section ${s.score.offsets}`);
  for (const c of Object.values(b.claims))
    for (const id of c.restsOn) if (!(id in b.claims)) problems.push(`claims.${c.id}.restsOn: unknown claim ${id}`);
  return problems;
}

const years = (period: string) => {
  const [from, to] = period.split("-").map(Number);
  return (to ?? from ?? 0) - (from ?? 0);
};

/**
 * The whole-bill deficit line to headline for a baseline: from the latest published CBO estimate that has one (a
 * signed law's estimate beats the House-passed one), the longest period it gives. Ties go to the larger id.
 */
export function headlineDeficit(b: Bundle, baseline: Dollar["baseline"]): Dollar | undefined {
  const published = new Map(b.dollars.estimates.map((e) => [e.id, e.publishedOn]));
  return b.dollars.wholeBill
    .filter((d) => d.measure === "deficit" && d.baseline === baseline)
    .sort(
      (x, y) =>
        (published.get(y.estimateId) ?? "").localeCompare(published.get(x.estimateId) ?? "") ||
        y.estimateId.localeCompare(x.estimateId) ||
        years(y.period) - years(x.period),
    )[0];
}

/** The last roll call members' votes are drawn for, with how each party voted on it. */
function finalVote(b: Bundle) {
  const voted = new Set(
    b.edges.filter((e) => e.kind === "voted").map((e) => (e.kind === "voted" ? e.props.rollId : "")),
  );
  const roll = b.votes
    .filter((v) => voted.has(v.id))
    .sort((x, y) => x.date.localeCompare(y.date) || x.number - y.number)
    .at(-1);
  if (!roll) return null;
  const party = new Map(b.nodes.flatMap((n) => (n.kind === "member" ? [[n.id, n.props.party] as const] : [])));
  const byParty: Partial<Record<"R" | "D" | "I", { yea: number; nay: number }>> = {};
  for (const e of b.edges) {
    if (e.kind !== "voted" || e.props.rollId !== roll.id || (e.props.vote !== "Yea" && e.props.vote !== "Nay"))
      continue;
    const p = party.get(e.src);
    if (!p) continue;
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

/**
 * Stakes big enough for the buried label (buried-v2's 2/3 bar on the stakes scale): $10B in a CBO figure CBO gave the
 * section itself, or 21 lobbying firms. A test in packages/analyze keeps these in step with `SCORE.costlyMin`.
 */
export const BIG_STAKES = { dollarsMusd: 10_000, firms: 21 };
/** A bill with fewer sections has nothing for one to be buried among (`SCORE.minSections`). */
export const MIN_SECTIONS_TO_BURY = 10;
/** Stakes big in dollars or lobbying: what "costly" means on the page. Reach is the other way to big stakes. */
export const bigStakes = (c: { dollarsMusd: number | null; dollarsSplit: string | null; lobbyingFirms: number }) =>
  (c.dollarsMusd !== null && c.dollarsSplit !== "even_split" && Math.abs(c.dollarsMusd) >= BIG_STAKES.dollarsMusd) ||
  c.lobbyingFirms >= BIG_STAKES.firms;

/** What each kind of reach does, in the words the page uses. */
export const REACH_WORDS: Record<ReachKind, string> = {
  courts: "limits courts",
  states: "overrides state law",
  lawsuit: "opens lawsuits",
  review: "skips public review",
  rule: "blocks a rule",
};

/** Why a buried section is flagged: "quiet and costly" when dollars or lobbying make its stakes big, else its reach ("quiet, limits courts"). */
export function buriedWords(score: z.infer<typeof Score>): string {
  const c = score.components;
  return bigStakes(c) || !c.reach.length
    ? "quiet and costly"
    : `quiet, ${c.reach.map((k) => REACH_WORDS[k]).join(", ")}`;
}

/** Whether the page calls a section late: the lineage flag, unless a model-paired older section was already in the text. */
export const isLate = (s: Pick<Section, "late" | "score">) => s.score?.components.late ?? s.late;

/** Articles that discuss a section, counted the way the score counts them: the matcher's plus a second look's. Null when news is unmeasured for it. */
export const articlesOf = (s: Pick<Section, "attention" | "score">) =>
  s.attention ? s.attention.hits + (s.score?.components.attentionChecked ?? 0) : null;

/** Trade dates from the first text through signing (or the last dated action): the span in which a trade could be about the bill. */
export function activeSpan(b: Bundle): [string, string] | null {
  const own = b.versions.filter((v) => !v.predecessor && v.date).map((v) => v.date!);
  const start = own.sort()[0];
  const end =
    b.bill.lawOn ??
    [...b.votes.map((v) => v.date), ...b.versions.map((v) => v.date)]
      .filter((d): d is string => !!d)
      .sort()
      .at(-1);
  return start && end ? [start, end] : null;
}

/** An annual appropriations act: CBO's estimate of it covers only the direct spending and revenue provisions. */
export const isAppropriations = (b: Bundle) => /appropriations/i.test(`${b.bill.title} ${b.bill.shortTitle ?? ""}`);

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
  const ranked = final.some((s) => s.attention?.pct != null);
  const priced = final.filter(
    (s) => s.score?.components.dollarsMusd != null && s.score.components.dollarsSplit !== "even_split",
  ).length;
  const dollarsMeasured = priced > 0;
  const big = final.filter((s) => s.score && bigStakes(s.score.components)).length;
  const reach = final.filter((s) => s.score?.components.reach.length).length;
  const why =
    final.length < MIN_SECTIONS_TO_BURY
      ? `the bill has only ${final.length} ${final.length === 1 ? "section" : "sections"}, too few for anything to be buried among`
      : !ranked
        ? "too few news articles to rank this bill's sections"
        : !dollarsMeasured && !big && !reach
          ? "CBO gave no section its own dollar figure, no section is named in enough lobbying reports, and no section's text has reach, so no section's stakes are known"
          : null;
  return {
    sections: final.length,
    headline: final.filter((s) => s.score?.label === "headline").length,
    buried: final.filter((s) => s.score?.label === "buried").length,
    late: b.bill.lateUnavailable ? null : final.filter(isLate).length,
    tally: finalVote(b),
    lobbyingReports: b.lobbying.reports,
    companies: new Set(b.edges.filter((e) => e.kind === "benefits").map((e) => e.dst)).size,
    membersTraded: new Set(traders.map((e) => e.src)).size,
    membersTradedDuring: during.size,
    buriedTest: { tested: why === null, why, bigStakes: big, dollarsMeasured, costMeasured: priced, reach },
    cboPublished: b.dollars.estimates.length > 0,
    deficitDirectOnly: isAppropriations(b) && !!deficit,
    tradeSpan: span,
    lateShare: b.bill.lateUnavailable || !final.length ? null : final.filter(isLate).length / final.length,
    vehicle: !!b.bill.vehicle,
    deficitMusd: deficit?.amountMusd ?? null,
    fingerprint: final.map((s) => (s.score ? s.score.label[0] : "u")).join(""),
  };
}
