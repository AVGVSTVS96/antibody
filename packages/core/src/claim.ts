import { z } from "zod";

export const ClaimKind = z.enum(["fact", "inference"]);
export type ClaimKind = z.infer<typeof ClaimKind>;

/** Source pages that look like citations but don't point at one record. A claim needs the record itself. */
const STUB_URLS = [
  /efdsearch\.senate\.gov\/search\/view\/ptr\/?$/,
  /efdsearch\.senate\.gov\/search\/?$/,
  /disclosures-clerk\.house\.gov\/(?:FinancialDisclosure|PublicDisclosure)?\/?$/,
  /lda\.gov\/filings\/?$/,
  /cbo\.gov\/?$/,
  /congress\.gov\/?$/,
  /fec\.gov\/data\/?$/,
];

export const SourceUrl = z
  .url({ protocol: /^https?$/ })
  .refine((u) => !STUB_URLS.some((re) => re.test(u)), "source URL is a search page or stub, not the record itself");

/**
 * Claim ids are `<table>/<row id>` for the row that states it, plus `#<facet>` when one row states
 * several things (e.g. `cbo_lines/hr1-clb:70101:deficit`, `trades/20032256#3`).
 */
export const ClaimId = z.string().regex(/^[a-z_]+\/.+$/);
export type ClaimId = z.infer<typeof ClaimId>;

export const Claim = z
  .object({
    id: ClaimId,
    /** One plain sentence, same wording template for every party. */
    text: z.string().min(1),
    kind: ClaimKind,
    /** The one primary record this rests on (congress.gov, GovInfo, CBO, FEC, lda.gov, House Clerk, Senate eFD, SEC). */
    sourceUrl: SourceUrl,
    /** Where inside the source, readable by a person: "page 3, row 7", "Title VII sheet, cells A19:O21 and A374:O375". */
    sourceLocator: z.string().nullable(),
    /** The copy we actually read when the primary blocks scripts (cbo.gov via web.archive.org). */
    archiveUrl: z.url().nullable(),
    /** Exact words from the source, when the claim quotes it (a lobbyist's covered position, a CBO sentence). */
    quote: z.string().nullable(),
    /** 1 for a fact read from a text layer; below 1 for vision-read cells and for inferences. */
    confidence: z.number().min(0).max(1),
    /** Claim ids this one is derived from. Required for inferences; for a derived fact (a deficit) the facts it sums. */
    restsOn: z.array(ClaimId),
    /** The named, published rule an inference applies, e.g. "tied-stock: the company lobbied on the bill". */
    rule: z.string().nullable(),
  })
  .refine((c) => c.kind === "fact" || (c.rule && c.restsOn.length > 0), {
    message: "an inference names its rule and what it rests on",
  });
export type Claim = z.infer<typeof Claim>;
