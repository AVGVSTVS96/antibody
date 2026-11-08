import { z } from "zod";

export const ClaimKind = z.enum(["fact", "inference"]);

export type ClaimKind = z.infer<typeof ClaimKind>;

const STUB_URLS = [
  /efdsearch\.senate\.gov\/search\/view\/ptr\/?$/u,
  /efdsearch\.senate\.gov\/search\/?$/u,
  /disclosures-clerk\.house\.gov\/(?:FinancialDisclosure|PublicDisclosure)?\/?$/u,
  /lda\.gov\/filings\/?$/u,
  /cbo\.gov\/?$/u,
  /congress\.gov\/?$/u,
  /fec\.gov\/data\/?$/u,
];

export const SourceUrl = z
  .url({ protocol: /^https?$/u })
  .refine((u) => !STUB_URLS.some((re) => re.test(u)), "source URL is a search page or stub, not the record itself");

export const ClaimId = z.string().regex(/^[a-z_]+\/.+$/u);

export type ClaimId = z.infer<typeof ClaimId>;

export const Claim = z
  .object({
    id: ClaimId,
    text: z.string().min(1),
    kind: ClaimKind,
    sourceUrl: SourceUrl,
    sourceLocator: z.string().nullable(),
    archiveUrl: z.url().nullable(),
    quote: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    restsOn: z.array(ClaimId),
    rule: z.string().nullable(),
  })
  .refine((c) => c.kind === "fact" || (c.rule !== null && c.rule !== "" && c.restsOn.length > 0), {
    message: "an inference names its rule and what it rests on",
  });

export type Claim = z.infer<typeof Claim>;
