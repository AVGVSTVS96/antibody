import { z } from "zod";
import { ClaimId, ClaimKind } from "./claim.ts";
import type { BillId } from "./ids.ts";

export const NodeKind = z.enum([
  "bill",
  "section",
  "member",
  "company",
  "client",
  "registrant",
  "lobbyist",
  "committee",
  "pac",
]);
export type NodeKind = z.infer<typeof NodeKind>;

/**
 * Node ids are `<kind>:<key>`:
 * bill:119-s-1582 · section:119-s-1582@s394-is:sec:6 · member:H000601 (bioguide) · company:1403161 (SEC CIK)
 * client:visa (merged LDA client key) · registrant:401109062 · lobbyist:148179 (LDA ids) · committee:SSBK (Thomas id)
 * pac:C00431312 (FEC committee id)
 */
export type NodeId = `${NodeKind}:${string}`;
export const NodeId = z.string().regex(new RegExp(`^(${NodeKind.options.join("|")}):.+$`)) as z.ZodType<NodeId>;

export const nodeId = <K extends NodeKind>(kind: K, key: string | number): `${K}:${string}` => `${kind}:${key}`;
export const billNode = (id: BillId) => nodeId("bill", id);

export const Owner = z.enum(["self", "spouse", "joint", "dependent"]);
export type Owner = z.infer<typeof Owner>;

export const TradeEvent = z.object({
  date: z.iso.date(),
  type: z.enum(["purchase", "sale", "sale_partial", "exchange"]),
  /** As filed, e.g. "$15,001 - $50,000". */
  amount: z.string(),
  /** Always shown: a spouse's trade is labeled as the spouse's. */
  owner: Owner,
  ticker: z.string().nullable(),
  asset: z.string(),
  readBy: z.enum(["text", "html", "vision"]),
  /** False when the asset name on the disclosure shares no word with the company's SEC name; the join was by ticker alone. */
  nameMatch: z.boolean().optional(),
  claim: ClaimId,
});
export type TradeEvent = z.infer<typeof TradeEvent>;

const Phases = z.object({ bill: z.number(), enactmentQuarter: z.number(), law: z.number() });

/** Every edge kind with its props. Direction is src → dst as commented. */
export const EDGE_PROPS = {
  /** member → bill */
  sponsored: z.object({
    role: z.enum(["sponsor", "cosponsor"]),
    date: z.iso.date().nullable(),
    withdrawnOn: z.iso.date().nullable(),
  }),
  /** member → bill; the roll call is in bundle.votes */
  voted: z.object({ rollId: z.string(), vote: z.enum(["Yea", "Nay", "Present", "Not Voting"]) }),
  /** member → committee */
  member_of: z.object({ role: z.string().nullable() }),
  /** bill → committee */
  referred: z.object({ activity: z.string().nullable() }),
  /** member → section: the member's agreed amendment added or rewrote the section */
  inserted: z.object({ amendmentId: z.string(), how: z.enum(["text", "inferred"]) }),
  /** client → bill | section; dollars are the factual total for client-quarters that named the bill, the share is an inference */
  lobbied: z.object({
    reports: z.number(),
    quarters: z.number(),
    phases: Phases,
    spendTotalUsd: z.number().nullable(),
    shareEstimateUsd: z.number().nullable(),
    /** The inference behind shareEstimateUsd; kept off `claims` so the factual edge isn't drawn dashed. */
    shareClaim: ClaimId.nullable().optional(),
    issueQuote: z.string().nullable(),
    topicOnly: z.boolean(),
  }),
  /** client → registrant */
  hired: z.object({ reports: z.number() }),
  /** registrant → lobbyist */
  employs: z.object({ reports: z.number() }),
  /** pac → member */
  funded: z.object({
    /** The member's passage vote, or the bill's enactment (or last dated action) when they cast none. Gifts on or before it are "before". */
    cutoff: z.iso.date(),
    cutoffKind: z.enum(["vote", "enactment"]),
    beforeUsd: z.number(),
    afterUsd: z.number(),
    amountUsd: z.number(),
    contributions: z.number(),
    first: z.iso.date(),
    last: z.iso.date(),
    allTxnsUrl: z.url(),
  }),
  /** member → company */
  traded: z.object({ events: z.array(TradeEvent).min(1) }),
  /** client | pac → company */
  resolves_to: z.object({ method: z.string(), reason: z.string().nullable() }),
  /** bill | section → company */
  benefits: z.object({ rule: z.enum(["lobbied", "named-in-text"]) }),
} as const;

export const EdgeKind = z.enum(Object.keys(EDGE_PROPS) as [keyof typeof EDGE_PROPS, ...(keyof typeof EDGE_PROPS)[]]);
export type EdgeKind = z.infer<typeof EdgeKind>;

const edgeOf = <K extends EdgeKind>(kind: K) =>
  z.object({
    id: z.string(),
    kind: z.literal(kind),
    src: NodeId,
    dst: NodeId,
    /** fact only if every claim behind it is a fact; inference edges draw dashed with an "inference" pill. */
    basis: ClaimKind,
    claims: z.array(ClaimId).min(1),
    /** how many further claims back this edge beyond the ones listed (store keeps a few per edge, props carry the totals). */
    moreClaims: z.number().int().positive().optional(),
    props: EDGE_PROPS[kind],
  });

export const Edge = z.discriminatedUnion("kind", [
  edgeOf("sponsored"),
  edgeOf("voted"),
  edgeOf("member_of"),
  edgeOf("referred"),
  edgeOf("inserted"),
  edgeOf("lobbied"),
  edgeOf("hired"),
  edgeOf("employs"),
  edgeOf("funded"),
  edgeOf("traded"),
  edgeOf("resolves_to"),
  edgeOf("benefits"),
]);
export type Edge = z.infer<typeof Edge>;
export type EdgeOf<K extends EdgeKind> = Extract<Edge, { kind: K }>;
