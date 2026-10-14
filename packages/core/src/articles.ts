import { z } from "zod";
import { type Bundle, Example } from "./bundle.ts";

/**
 * Every news article the matcher counted for a bill's sections, in `<bill>.articles.json` beside the bundle (the
 * bundle itself keeps three examples per section). An article that discusses several sections is listed once;
 * sections point at it by position. Trade and legal press is counted apart and is not listed. The claims the entries
 * name are in the bundle's claims.
 */
export const ArticleList = z.object({
  schema: z.literal(1),
  billId: z.string(),
  /** Newest first, then by claim id. */
  articles: z.array(Example),
  /** Section id to positions in `articles`; only sections at least one counted article discusses. */
  bySection: z.record(z.string(), z.array(z.number().int())),
  /** Positions of the articles about the bill as a whole or outside its text. */
  general: z.array(z.number().int()),
});
export type ArticleList = z.infer<typeof ArticleList>;

/** What zod can't check: every position exists, every claim is in the bundle, and each section's count is the bundle's `hits`. */
export function checkArticleList(list: ArticleList, b: Bundle): string[] {
  const problems: string[] = [];
  if (list.billId !== b.bill.id) problems.push(`list is for ${list.billId}, bundle for ${b.bill.id}`);
  for (const [i, a] of list.articles.entries())
    if (!(a.claim in b.claims)) problems.push(`articles[${i}]: unknown claim ${a.claim}`);
  const known = (positions: number[]) => positions.every((p) => p >= 0 && p < list.articles.length);
  if (!known(list.general)) problems.push("general: position out of range");
  if (list.general.length !== (b.attention.general?.hits ?? 0))
    problems.push(
      `general: ${list.general.length} articles listed, the bundle counts ${b.attention.general?.hits ?? 0}`,
    );
  const hits = new Map(b.sections.map((s) => [s.id, s.attention?.hits ?? 0]));
  for (const [id, positions] of Object.entries(list.bySection)) {
    if (!known(positions)) problems.push(`${id}: position out of range`);
    if (!hits.has(id)) problems.push(`${id}: not a section of the bundle`);
    else if (hits.get(id) !== positions.length)
      problems.push(`${id}: ${positions.length} articles listed, the bundle counts ${hits.get(id)}`);
  }
  return problems;
}
