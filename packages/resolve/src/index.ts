import type { Stage } from "@antibody/core";
import { readRows, writeRows } from "@antibody/core/node";
import { lobbiedBenefits } from "./benefits.ts";
import { cachedSic, companyRows, fetchSubmissions, loadEdgar } from "./edgar.ts";
import { CompanyIndex } from "./match.ts";
import { clientMentions, employerMentions, pacMentions, tradeMentions } from "./mentions.ts";
import { namedBenefits } from "./named.ts";
import { resolveAll } from "./resolve.ts";

export { RULES } from "./rules.ts";

/**
 * companies: SEC's ticker list as `companies` rows (id = CIK).
 * resolve: every lobbying client, PAC sponsor, donors' employer and stock trade → a company, as `resolutions` rows (id = the src).
 *   Runs per bill so new clients get resolved, but resolves everything incrementally: the model only sees new names.
 * benefits: companies tied to the bill (decision tied-stock): lobbied on it, or named in its text.
 */
export const stages: Stage[] = [
  {
    name: "companies",
    scope: "global",
    needs: [],
    writes: ["companies"],
    async run(ctx) {
      const companies = await loadEdgar(ctx.refresh);
      await writeRows("companies", "edgar", companyRows(companies, await cachedSic()));
      ctx.log(`${companies.length} SEC companies with tickers`);
    },
  },
  {
    name: "resolve",
    scope: "bill",
    needs: ["companies"],
    writes: ["resolutions", "companies"],
    async run(ctx) {
      const companies = await loadEdgar();
      const index = new CompanyIndex(companies);
      for (const [shard, mentions] of [
        ["clients", clientMentions(await readRows("lda_clients"))],
        ["pacs", pacMentions(await readRows("pacs"))],
        ["employers", employerMentions(await readRows("employer_contributions"))],
        ["trades", tradeMentions(await readRows("trades"))],
      ] as const) {
        const r = await resolveAll(mentions, index, { log: ctx.log, signal: ctx.signal });
        await writeRows("resolutions", shard, r.rows);
        const unique = new Set(r.outcomes.map((o) => o.mention.src)).size;
        ctx.log(`${shard}: ${r.rows.length} of ${mentions.length} resolved (${unique} distinct names)`);
      }
      const resolved = new Set((await readRows("resolutions")).map((r) => r.company_id));
      await fetchSubmissions(resolved, ctx.log);
      await writeRows("companies", "edgar", companyRows(companies, await cachedSic()));
    },
  },
  {
    name: "benefits",
    scope: "bill",
    needs: ["resolve"],
    writes: ["benefits"],
    async run(ctx) {
      const bill = ctx.bill!;
      const sections = (await readRows("sections")).filter((s) => s.bill_id === bill);
      const versions = (await readRows("versions")).filter((v) => v.bill_id === bill);
      const refs = (await readRows("lda_bill_refs")).filter((r) => r.bill_id === bill);
      const ids = new Set(refs.map((r) => r.filing_id));
      const filings = new Map((await readRows("lda_filings")).filter((f) => ids.has(f.id)).map((f) => [f.id, f]));
      const resolutions = new Map((await readRows("resolutions", "clients")).map((r) => [r.id, r]));
      const lobbied = lobbiedBenefits(bill, refs, filings, resolutions, sections);
      const named = await namedBenefits(bill, versions, sections, await loadEdgar(), ctx.log, ctx.signal);
      await writeRows("benefits", bill, [...lobbied, ...named]);
      const companies = (rows: { company_id: string }[]) => new Set(rows.map((r) => r.company_id)).size;
      ctx.log(`${companies(lobbied)} companies lobbied on it, ${companies(named)} named in its text`);
    },
  },
];
export { norm, parseAsset, tokens } from "./normalize.ts";
export { ownedOn, ownedSince } from "./since.ts";
