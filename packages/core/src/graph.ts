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

export type NodeId = `${NodeKind}:${string}`;

export const NodeId = z.templateLiteral([NodeKind, ":", z.string().regex(/^.+$/u)]);

export const nodeId = <K extends NodeKind>(kind: K, key: string | number): `${K}:${string}` => `${kind}:${key}`;
export const billNode = (id: BillId) => nodeId("bill", id);

export const Owner = z.enum(["self", "spouse", "joint", "dependent"]);

export type Owner = z.infer<typeof Owner>;

export const TradeEvent = z.object({
  date: z.iso.date(),
  type: z.enum(["purchase", "sale", "sale_partial", "exchange"]),
  amount: z.string(),
  owner: Owner,
  ticker: z.string().nullable(),
  asset: z.string(),
  readBy: z.enum(["text", "html", "vision"]),
  nameMatch: z.boolean().optional(),
  claim: ClaimId,
});

export type TradeEvent = z.infer<typeof TradeEvent>;

const Phases = z.object({ bill: z.number(), enactmentQuarter: z.number(), law: z.number() });

export const EDGE_PROPS = {
  sponsored: z.object({
    role: z.enum(["sponsor", "cosponsor"]),
    date: z.iso.date().nullable(),
    withdrawnOn: z.iso.date().nullable(),
  }),
  voted: z.object({ rollId: z.string(), vote: z.enum(["Yea", "Nay", "Present", "Not Voting"]) }),
  member_of: z.object({ role: z.string().nullable() }),
  referred: z.object({ activity: z.string().nullable() }),
  inserted: z.object({ amendmentId: z.string(), how: z.enum(["text", "inferred"]) }),
  lobbied: z.object({
    reports: z.number(),
    quarters: z.number(),
    phases: Phases,
    spendTotalUsd: z.number().nullable(),
    shareEstimateUsd: z.number().nullable(),
    shareClaim: ClaimId.nullable().optional(),
    issueQuote: z.string().nullable(),
    topicOnly: z.boolean(),
  }),
  hired: z.object({ reports: z.number() }),
  employs: z.object({ reports: z.number() }),
  funded: z.object({
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
  traded: z.object({ events: z.array(TradeEvent).min(1) }),
  resolves_to: z.object({ method: z.string(), reason: z.string().nullable() }),
  benefits: z.object({ rule: z.enum(["lobbied", "named-in-text"]) }),
} as const;

export const EdgeKind = z.keyof(z.object(EDGE_PROPS));

export type EdgeKind = z.infer<typeof EdgeKind>;

const edgeOf = <K extends EdgeKind>(kind: K) =>
  z.object({
    id: z.string(),
    kind: z.literal(kind),
    src: NodeId,
    dst: NodeId,
    basis: ClaimKind,
    claims: z.array(ClaimId).min(1),
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
