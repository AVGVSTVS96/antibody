import {
  Bundle as BundleSchema,
  Edge as EdgeSchema,
  billDisplay,
  billRef,
  billstatusUrl,
  checkBundle,
  congressGovUrl,
  NodeId as NodeIdSchema,
  nodeId,
  OutletGroup,
  ReachKind,
  SectionStep,
  TABLE_NAMES,
  TABLES,
  filled,
} from "@antibody/core";
import type {
  BillId,
  Bundle,
  Claim,
  ClaimId,
  Dollar,
  Edge,
  EdgeKind,
  EdgeOf,
  Node,
  NodeId,
  Part,
  Row,
  Section,
  TableName,
} from "@antibody/core";
import { norm, ownedOn, ownedSince, tokens } from "@antibody/resolve";
import { missing, mintClaim, restsOnOf } from "./claims.ts";
import type { CitedRow, Member, Names } from "./claims.ts";
import { CURATED } from "./curated.ts";
import { countOf, isNumber, isPlain, isText, query, tableNames } from "./db.ts";
import type { Db, Param, Plain, PlainRow } from "./db.ts";
import { limitGraph } from "./limit.ts";
import { ruleFor } from "./rules.ts";
import { count, day, lawNumber, memberLabel, quarter } from "./text.ts";
import { nameMatches, reusedTicker, securityOf } from "./trades.ts";
import { trimEvidence } from "./trim.ts";

export interface BuildResult {
  bundle: Bundle;
  warnings: string[];
}

const DESCRIPTION = /^(?:an act|a bill|to )\b/iu;

const NO_POSITION = /^(?:n\/?a|none|no|yes|nil|see form ld-?1.*|[-.\s]*)\.?$/iu;

const YEAR = 365 * 24 * 3600 * 1000;

export const firstWords = (text: string | null | undefined) => {
  const words = (text ?? "")
    .replace(/^\s*(?:SEC(?:TION)?\.?\s*\d+[A-Za-z]?\.?\s*)/iu, "")
    .replace(/^(?:\s*\((?:[a-z]{1,2}|\d+)\))+\s*(?=[A-Z])/u, "")
    .split(/\s+/u)
    .filter((w) => w !== "");

  return words.length > 0 ? `${words.slice(0, 10).join(" ")}${words.length > 10 ? "…" : ""}` : "(no heading)";
};

const OWN_PAC = new Set(["ticker", "name_exact", "fuzzy", "llm_same"]);
const headOf = (name: string) => tokens(norm(name))[0] ?? "";
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const PASSAGE = /pass|concur|conference report|veto/iu;

const committeeKey = (id: string) => id.toUpperCase().replace(/^([A-Z]{4})00$/u, "$1");

const isTableName = (t: string): t is TableName => TABLE_NAMES.some((name) => name === t);

function parseRow<T extends TableName>(table: T, row: PlainRow): Row<T> {
  const schemas: { [K in TableName]: { schema: { parse: (r: PlainRow) => Row<K> } } } = TABLES;

  return schemas[table].schema.parse(row);
}

const ArticleWithOutlet = TABLES.articles.schema.extend({
  outlet_name: TABLES.outlets.schema.shape.name.nullable(),
  outlet_group: TABLES.outlets.schema.shape.group.nullable(),
  list_version: TABLES.outlets.schema.shape.list_version.nullable(),
});

const ScoredPart = TABLES.section_scores.schema.pick({ section_id: true, part_id: true, label: true, late: true });

const ReachedPart = TABLES.section_reach.schema.pick({ part_id: true });

interface Fields {
  [k: string]: Plain | undefined;
}

const isFields = (v: unknown): v is Fields =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).every(isPlain);

const isCounts = (v: unknown): v is { [k: string]: number } => isFields(v) && Object.values(v).every(isNumber);

const sumOf = (counts: { [k: string]: number }) => Object.values(counts).reduce((a, n) => a + n, 0);

const cycle = (t: number) => {
  const y = new Date(t).getUTCFullYear();

  return y % 2 === 1 ? y + 1 : y;
};

const counted = (s: Row<"lda_spend">) => {
  const list = s.evidence.counted;

  return Array.isArray(list) ? list.length : 0;
};

type BillRef = Row<"lda_bill_refs"> | Row<"lda_topic_refs">;

export async function buildBundle(
  db: Db,
  bill: BillId,
  { now = new Date(), names = curatedNames }: { now?: Date; names?: Record<string, string> } = {},
): Promise<BuildResult> {
  return await new Builder(db, bill, now, names[bill] ?? null).build();
}

const curatedNames = Object.fromEntries(CURATED.map((c) => [c.id, c.name]));

class Builder {
  private readonly claims = new Map<ClaimId, Claim>();
  private readonly pending = new Set<ClaimId>();
  private readonly rows = new Map<string, CitedRow<TableName>>();
  private readonly nodes = new Map<NodeId, Node>();
  private readonly edges = new Map<string, Edge>();
  private readonly warnings: string[] = [];
  private tables = new Set<string>();
  private readonly cols = new Map<string, Set<string>>();
  private readonly members = new Map<string, Member>();
  private readonly memberIds = new Set<string>();
  private readonly sections = new Map<string, Section>();
  private readonly parts = new Map<string, Part>();
  private readonly versionNames = new Map<string, string>();
  private readonly filings = new Map<string, Row<"lda_filings">>();
  private readonly labels = {
    company: new Map<string, string>(),
    pac: new Map<string, string>(),
    client: new Map<string, string>(),
    committee: new Map<string, string>(),
    roll: new Map<string, string>(),
    amendment: new Map<string, string>(),
    estimate: new Map<string, Row<"cbo_estimates">>(),
  };
  private readonly rulesUsed = new Set<string>();
  private readonly votedOn = new Map<string, string>();
  private lateUnavailable: string | null = null;
  private heldOutEarlier = 0;
  private readonly nonStock = { option: 0, bond: 0, other: 0 };
  private readonly display: string;
  private readonly db: Db;
  private readonly bill: BillId;
  private readonly now: Date;
  private readonly curatedName: string | null;

  constructor(db: Db, bill: BillId, now: Date, curatedName: string | null) {
    this.db = db;
    this.bill = bill;
    this.now = now;
    this.curatedName = curatedName;
    this.display = billDisplay(bill);
  }

  private readonly names: Names = {
    bill: "",
    display: "",
    member: (b) => {
      const m = filled(b) ? this.members.get(b) : undefined;

      return m ? { name: m.name, party: m.party, state: m.state, chamber: m.chamber } : null;
    },
    section: (id) => (filled(id) ? (this.sections.get(id) ?? this.parts.get(id) ?? null) : null),
    version: (code) => (filled(code) ? (this.versionNames.get(code) ?? code) : "unknown"),
    company: (id) => this.labels.company.get(id) ?? `the company with SEC CIK ${id}`,
    pac: (id) => this.labels.pac.get(id) ?? `FEC committee ${id}`,
    client: (key) => this.labels.client.get(key) ?? key,
    filing: (id) => {
      const f = this.filings.get(id);

      return f
        ? { registrant: f.registrant_name, client: f.client_name, when: `${quarter(f.period)} ${f.year}` }
        : null;
    },
    clientFilingUrl: (key) => [...this.filings.values()].find((f) => f.client_key === key)?.url,
    committee: (id) => this.labels.committee.get(committeeKey(id)) ?? `committee ${id}`,
    roll: (id) => this.labels.roll.get(id) ?? `roll call ${id}`,
    amendment: (id) => this.labels.amendment.get(id) ?? `Amendment ${id}`,
    estimate: (id) => this.labels.estimate.get(id) ?? null,
    sample: { found: 0, relevant: 0 },
    today: "",
  };

  private async select<T extends TableName>(
    table: T,
    where = "true",
    params?: Record<string, Param>,
    order?: string,
  ): Promise<Row<T>[]> {
    if (!this.tables.has(table)) {
      return [];
    }

    const by = filled(order) ? `${order}, id` : "id";
    const found = await query(this.db, `SELECT * FROM ${table} WHERE ${where} ORDER BY ${by}`, params);
    const rows = found.map((r) => parseRow(table, r));

    for (const r of rows) {
      this.rows.set(`${table}/${r.id}`, r);
    }

    return rows;
  }

  private has(table: string, column: string) {
    return this.cols.get(table)?.has(column) ?? false;
  }

  private known(id: ClaimId) {
    return this.claims.has(id) || this.pending.has(id);
  }

  private async cite<T extends TableName>(
    table: T,
    row: CitedRow<T>,
    facet: string | null = null,
  ): Promise<ClaimId | null> {
    const id = `${table}/${row.id}${filled(facet) ? `#${facet}` : ""}`;

    if (this.known(id)) {
      return id;
    }

    this.rows.set(`${table}/${row.id}`, row);
    this.pending.add(id);

    try {
      const restsOn = await this.resolve(restsOnOf(table, row, facet, this.names), id);

      const claim = mintClaim(table, row, facet, this.names, restsOn, (ids) =>
        ids.map((x) => this.claims.get(x)?.sourceUrl).find(filled),
      );

      if (claim.kind === "inference" && filled(claim.rule)) {
        this.rulesUsed.add(claim.rule);
      }

      this.claims.set(id, claim);

      return id;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.warnings.push(`claim ${id}: ${message.replaceAll(/\s+/gu, " ").slice(0, 300)}`);

      return null;
    } finally {
      this.pending.delete(id);
    }
  }

  private async resolve(ids: ClaimId[], from: ClaimId): Promise<ClaimId[]> {
    const out: ClaimId[] = [];

    for (const id of ids) {
      if (id === from) {
        continue;
      }

      if (this.known(id) || (await this.ensure(id))) {
        out.push(id);
      } else {
        this.warnings.push(`claim ${from}: rests on ${id}, which isn't in the tables`);
      }
    }

    return out;
  }

  private async ensure(id: ClaimId): Promise<boolean> {
    const slash = id.indexOf("/");
    const table = id.slice(0, slash);
    const rest = id.slice(slash + 1);

    if (!isTableName(table)) {
      return false;
    }

    const cuts = [rest.length, ...[...rest.matchAll(/#/gu)].map((m) => m.index).toReversed()];

    for (const cut of cuts) {
      const rowId = rest.slice(0, cut);
      const facet = cut < rest.length ? rest.slice(cut + 1) : null;
      const row = this.rows.get(`${table}/${rowId}`) ?? (await this.select(table, "id = $id", { id: rowId }))[0];

      if (row) {
        return (await this.cite(table, row, facet)) !== null;
      }
    }

    return false;
  }

  private async cites<T extends TableName>(
    table: T,
    rows: CitedRow<T>[],
    facet: string | null = null,
  ): Promise<ClaimId[]> {
    const ids: ClaimId[] = [];

    for (const r of rows) {
      const id = await this.cite(table, r, facet);

      if (filled(id)) {
        ids.push(id);
      }
    }

    return ids;
  }

  private edge<K extends EdgeKind>(
    kind: K,
    id: string,
    src: NodeId,
    dst: NodeId,
    claims: ClaimId[],
    props: EdgeOf<K>["props"],
  ) {
    const ok = claims.filter((c) => this.claims.has(c));

    if (ok.length === 0) {
      this.warnings.push(`edge ${id}: no claim backs it, left out`);

      return;
    }

    const basis = ok.some((c) => this.claims.get(c)?.kind === "inference") ? "inference" : "fact";

    for (const end of [src, dst]) {
      if (end.startsWith("member:")) {
        this.memberIds.add(end.slice(7));
      }
    }

    this.edges.set(id, EdgeSchema.parse({ id, kind, src, dst, basis, claims: [...new Set(ok)], props }));
  }

  private node(n: Node) {
    if (!this.nodes.has(n.id)) {
      this.nodes.set(n.id, n);
    }
  }

  async build(): Promise<BuildResult> {
    this.tables = await tableNames(this.db);

    for (const r of await query(this.db, "SELECT table_name AS t, column_name AS c FROM duckdb_columns()")) {
      if (isText(r.t) && isText(r.c)) {
        getOrSet(this.cols, r.t, () => new Set()).add(r.c);
      }
    }

    const [bill] = await this.select("bills", "id = $id", { id: this.bill });

    if (!bill) {
      throw new Error(`no bills row for ${this.bill}: run the bills stage first`);
    }

    this.lateUnavailable = bill.late_unavailable ?? null;
    bill.short_title = this.curatedName ?? (await this.shortTitle(bill));
    this.names.display = this.display;
    this.names.bill = `${this.display}${filled(bill.short_title) ? ` (${bill.short_title})` : ""}`;
    this.names.sample = await this.attentionSample();
    this.names.today = isoDay(this.now.getTime());

    const versions = await this.buildVersions();
    await this.buildSections();
    const window = this.window(bill, versions);
    const congress = billRef(this.bill).congress;

    for (const m of await this.select("members")) {
      if (servedIn(m, congress)) {
        this.members.set(m.id, asOf(m, bill.law_on ?? window.end));
      }
    }

    const dollars = await this.buildDollars();
    const votes = await this.buildVotes();
    await this.buildSponsors();
    await this.buildCommittees();
    const amendments = await this.buildAmendments();
    const lobbying = await this.buildLobbying();
    const tied = await this.buildCompanies();
    await this.buildTrades(tied, window);
    await this.buildMoney(tied, window);
    const attention = await this.buildAttention();
    await this.buildScores();
    const unread = await this.buildMembers(window);

    const notes = await this.select("cbo_notes", "bill_id = $b AND section_id IS NULL", { b: this.bill });
    const sponsor = (await this.select("sponsorships", "bill_id = $b AND role = 'sponsor'", { b: this.bill }))[0];
    const sponsorId = sponsor?.bioguide ?? bill.sponsor_bioguide;

    const billCard = {
      id: this.bill,
      display: this.display,
      congress: billRef(this.bill).congress,
      title: bill.title,
      shortTitle: bill.short_title,
      sponsor: filled(sponsorId) && this.nodes.has(`member:${sponsorId}`) ? nodeId("member", sponsorId) : null,
      law: filled(bill.law) ? `P.L. ${lawNumber(bill.law)}` : null,
      lawOn: bill.law_on,
      latestAction: bill.latest_action,
      lateUnavailable: bill.late_unavailable ?? null,
      vehicle: vehicleNote(
        bill.late_unavailable ?? null,
        versions,
        [...this.sections.values()],
        filled(sponsorId) ? this.members.get(sponsorId) : undefined,
      ),
      url: bill.url ?? congressGovUrl(this.bill),
      billstatusUrl: billstatusUrl(this.bill),
      claims: [...(await this.cites("bills", [bill])), ...(await this.cites("cbo_notes", notes))],
    };

    const sections = [...this.sections.values()];

    const bundle: Bundle = {
      schema: 1,
      generatedAt: this.now.toISOString(),
      bill: billCard,
      versions,
      sections,
      votes,
      amendments,
      dollars,
      attention,
      lobbying,
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
      claims: {},
      gaps: await this.buildGaps({ dollars, attention, lobbying, unread, sections }),
      paperUnread: unread.byParty,
      rules: [],
    };

    bundle.claims = Object.fromEntries(this.claims);
    limitGraph(bundle);
    trimEvidence(bundle);
    const rules = new Map<string, Bundle["rules"][number]>();

    for (const used of this.rulesUsed) {
      const rule = ruleFor(used);
      getOrSet(rules, rule.id, () => rule);
    }

    bundle.rules = [...rules.values()];

    const parsed = BundleSchema.safeParse(bundle);

    if (!parsed.success) {
      throw new Error(`${this.bill}: bundle fails the schema: ${parsed.error.message.slice(0, 2000)}`);
    }

    const problems = checkBundle(parsed.data);

    if (problems.length > 0) {
      throw new Error(`${this.bill}: ${problems.length} dangling refs, e.g. ${problems.slice(0, 5).join("; ")}`);
    }

    return { bundle: parsed.data, warnings: this.warnings };
  }

  private async buildVersions(): Promise<Bundle["versions"]> {
    const rows = await this.select("versions", "bill_id = $b", { b: this.bill }, "date NULLS LAST, code");
    const out: Bundle["versions"] = [];

    for (const v of rows) {
      this.versionNames.set(v.code, `"${v.name}"`);
      const fact = await this.cite("versions", v);
      const claim = filled(v.predecessor_rule) ? await this.cite("versions", v, "predecessor") : fact;

      if (!filled(claim)) {
        continue;
      }

      if (filled(v.predecessor_rule)) {
        this.rulesUsed.add(v.predecessor_rule);
      }

      out.push({
        code: v.code,
        name: v.name,
        date: v.date,
        url: v.url,
        sections: v.sections,
        words: v.words,
        predecessor: filled(v.predecessor_rule),
        claim,
      });
    }

    return out;
  }

  private async buildSections() {
    const rows = await this.select("sections", "bill_id = $b", { b: this.bill });

    for (const s of rows) {
      this.sections.set(s.id, {
        id: s.id,
        num: s.num,
        heading: orElse(s.heading.trim(), () => firstWords(s.preview)),
        path: s.path,
        firstVersion: s.first_version,
        inFinal: s.in_final,
        late: s.late,
        changedIn: s.changed_in,
        removedIn: s.removed_in,
        revivedIn: s.revived_in,
        splitFrom: s.split_from,
        splitInto: s.split_into,
        mergedInto: s.merged_into,
        counterpart: null,
        words: s.words,
        textUrl: s.text_url,
        preview: s.preview,
        history: Object.fromEntries(Object.entries(s.history).map(([code, h]) => [code, step(isFields(h) ? h : {})])),
        dollars: [],
        attention: null,
        score: null,
        reach: [],
        parts: [],
        claims: [],
      });
    }

    for (const s of rows) {
      const id = await this.cite("sections", s);

      if (filled(id)) {
        this.sections.get(s.id)?.claims.push(id);
      }
    }

    for (const c of await this.select("counterparts", "bill_id = $b", { b: this.bill })) {
      const claim = await this.cite("counterparts", c);
      const removed = this.sections.get(c.removed_section_id);
      const added = this.sections.get(c.added_section_id);

      if (!filled(claim) || !removed || !added) {
        continue;
      }

      removed.counterpart = { sectionId: added.id, claim };
      added.counterpart = { sectionId: removed.id, claim };
    }

    for (const n of await this.select("cbo_notes", "bill_id = $b AND section_id IS NOT NULL", { b: this.bill })) {
      const claim = await this.cite("cbo_notes", n);

      if (filled(claim) && filled(n.section_id)) {
        this.sections.get(n.section_id)?.claims.push(claim);
      }
    }

    const notable = await this.notableParts(rows);

    for (const p of await this.select("section_parts", "bill_id = $b", { b: this.bill }, "section_id, ord")) {
      const section = this.sections.get(p.section_id);

      if (!section || !notable.has(p.id)) {
        continue;
      }

      const part: Part = {
        id: p.id,
        num: p.num,
        heading: orElse(p.heading.trim(), () => (p.lead_in ? "Opening words" : firstWords(p.preview))),
        trail: p.trail,
        leadIn: p.lead_in,
        words: p.words,
        preview: p.preview,
        firstVersion: p.first_version,
        late: p.late,
        textUrl: p.source_url,
        attention: null,
        score: null,
        reach: [],
        claims: [],
      };

      this.parts.set(p.id, part);
      this.rulesUsed.add("parts-v1");
      section.parts.push(part);
      const claim = await this.cite("section_parts", p);

      if (filled(claim)) {
        part.claims.push(claim);
      }
    }

    const kinds = ReachKind.options;
    const tags = await this.select("section_reach", "bill_id = $b", { b: this.bill });

    for (const r of tags.toSorted((x, y) => kinds.indexOf(x.kind) - kinds.indexOf(y.kind))) {
      const owner = filled(r.part_id) ? this.parts.get(r.part_id) : this.sections.get(r.section_id);
      const claim = owner ? await this.cite("section_reach", r) : null;

      if (owner && filled(claim)) {
        owner.reach.push({ kind: r.kind, quote: r.quote, claim });
      }
    }
  }

  private async notableParts(sections: Row<"sections">[]): Promise<Set<string>> {
    const b = { b: this.bill };
    const sectionLate = new Map(sections.map((s) => [s.id, s.late]));

    const scores = (
      await query(
        this.db,
        "SELECT section_id, part_id, label, late FROM section_scores WHERE bill_id = $b ORDER BY id",
        b,
      ).catch((): PlainRow[] => [])
    ).map((r) => ScoredPart.parse(r));

    for (const s of scores) {
      if (!filled(s.part_id)) {
        sectionLate.set(s.section_id, s.late);
      }
    }

    const keep = new Set<string>();

    for (const s of scores) {
      if (filled(s.part_id) && (s.label !== "normal" || (s.late && sectionLate.get(s.section_id) !== true))) {
        keep.add(s.part_id);
      }
    }

    const reached = await query(
      this.db,
      "SELECT part_id FROM section_reach WHERE bill_id = $b AND part_id IS NOT NULL ORDER BY id",
      b,
    ).catch((): PlainRow[] => []);

    for (const r of reached) {
      const { part_id: part } = ReachedPart.parse(r);

      if (filled(part)) {
        keep.add(part);
      }
    }

    return keep;
  }

  private async shortTitle(bill: Row<"bills">): Promise<string | null> {
    if (filled(bill.short_title) && !DESCRIPTION.test(bill.short_title)) {
      return bill.short_title;
    }

    const [first] = await this.select(
      "sections",
      "bill_id = $b AND regexp_matches(heading, '^short titles?\\b', 'i') AND NOT contains(path, '/')",
      { b: this.bill },
      "in_final DESC, id",
    );

    const cited = /may be cited as the (.+?)\s*\.?\s*$/iu.exec(first?.preview ?? "")?.[1];
    const name = cited?.replaceAll(/\s+/gu, " ").replaceAll(/[“”"]/gu, "").trim();

    return filled(name) ? name : bill.short_title;
  }

  private window(bill: Row<"bills">, versions: Bundle["versions"]) {
    const dates = [bill.introduced_on, bill.law_on, ...versions.map((v) => v.date)].filter(filled).toSorted();
    const start = Date.parse(bill.introduced_on ?? dates[0] ?? isoDay(this.now.getTime()));
    const end = Date.parse(bill.law_on ?? dates.at(-1) ?? isoDay(this.now.getTime()));

    const cycles: number[] = [];

    for (let c = cycle(start); c <= cycle(end); c += 2) {
      cycles.push(c);
    }

    return {
      tradeFrom: isoDay(start - YEAR),
      tradeTo: isoDay(Math.min(end + YEAR, this.now.getTime())),
      start: isoDay(start),
      end: isoDay(end),
      cycles,
    };
  }

  private async buildDollars(): Promise<Bundle["dollars"]> {
    const estimates: Bundle["dollars"]["estimates"] = [];

    for (const e of await this.select("cbo_estimates", "bill_id = $b", { b: this.bill }, "published_on NULLS LAST")) {
      this.labels.estimate.set(e.id, e);
      const claim = await this.cite("cbo_estimates", e);

      if (!filled(claim)) {
        continue;
      }

      const hasMandates = !missing(e.mandate_private) || !missing(e.mandate_intergovernmental);
      const mandatesClaim = hasMandates ? await this.cite("cbo_estimates", e, "mandates") : null;
      estimates.push({
        id: e.id,
        url: e.source_url,
        fileUrl: e.file_url,
        archiveUrl: e.archive_url,
        publishedOn: e.published_on,
        versionCode: e.version_code,
        versionScored: e.version_scored,
        baseline: e.baseline,
        baselineLabel: e.baseline_label,
        perSection: e.per_section,
        mandates: filled(mandatesClaim)
          ? {
              privateSector: e.mandate_private ?? "not stated",
              intergovernmental: e.mandate_intergovernmental ?? "not stated",
              claim: mandatesClaim,
            }
          : null,
        claim,
      });
    }

    const known = new Set(estimates.map((e) => e.id));
    const wholeBill: Dollar[] = [];

    for (const l of await this.select("cbo_lines", "bill_id = $b", { b: this.bill })) {
      const est = this.labels.estimate.get(l.estimate_id);

      if (!est || !known.has(l.estimate_id)) {
        continue;
      }

      const base = {
        estimateId: l.estimate_id,
        baseline: est.baseline,
        measure: l.measure,
        period: l.period,
        spending: l.spending,
      };

      if (l.line_kind === "whole-bill") {
        const claim = await this.cite("cbo_lines", l);

        if (filled(claim)) {
          wholeBill.push({ ...base, amountMusd: l.total_musd, split: "exact", claim });
        }

        continue;
      }

      if (l.line_kind !== "section") {
        continue;
      }

      const targets = l.section_ids.filter((s) => this.sections.has(s));
      const [only] = targets;

      if (only === undefined) {
        continue;
      }

      const fact = await this.cite("cbo_lines", l);

      if (!filled(fact)) {
        continue;
      }

      if (targets.length === 1 && l.section_ids.length === 1 && l.split === "exact") {
        this.sections.get(only)?.dollars.push({ ...base, amountMusd: l.total_musd, split: "exact", claim: fact });
        continue;
      }

      for (const s of targets) {
        const claim = await this.cite("cbo_lines", l, s);

        if (filled(claim)) {
          this.sections
            .get(s)
            ?.dollars.push({ ...base, amountMusd: l.total_musd / l.section_ids.length, split: "even_split", claim });
        }
      }
    }

    return { estimates, wholeBill };
  }

  private async buildVotes(): Promise<Bundle["votes"]> {
    const votes: Bundle["votes"] = [];
    const rolls = await this.select("roll_calls", "bill_id = $b", { b: this.bill }, "date, number");

    for (const r of rolls) {
      this.labels.roll.set(r.id, `${r.chamber} roll call ${r.number} of ${day(r.date)}`);
      const claim = await this.cite("roll_calls", r);

      if (filled(claim)) {
        votes.push({
          id: r.id,
          chamber: r.chamber,
          number: r.number,
          date: r.date,
          question: r.question,
          result: r.result,
          yeas: r.yeas,
          nays: r.nays,
          url: r.url,
          claim,
        });
      }
    }

    const passage = rolls.filter((r) => PASSAGE.test(r.question)).map((r) => r.id);
    const rollDate = new Map(rolls.map((r) => [r.id, r.date]));

    if (passage.length > 0) {
      this.rulesUsed.add("member-votes");
    }

    for (const v of await this.select("member_votes", "list_contains($ids, roll_id)", { ids: passage })) {
      if (!this.members.has(v.bioguide)) {
        continue;
      }

      const on = rollDate.get(v.roll_id);

      if (on !== undefined && v.vote !== "Not Voting" && on < (this.votedOn.get(v.bioguide) ?? "9")) {
        this.votedOn.set(v.bioguide, on);
      }

      const claim = await this.cite("member_votes", v);

      if (filled(claim)) {
        this.edge(
          "voted",
          `voted:${v.roll_id}:${v.bioguide}`,
          nodeId("member", v.bioguide),
          nodeId("bill", this.bill),
          [claim],
          { rollId: v.roll_id, vote: v.vote },
        );
      }
    }

    return votes;
  }

  private async buildSponsors() {
    for (const s of await this.select("sponsorships", "bill_id = $b", { b: this.bill })) {
      if (!this.members.has(s.bioguide)) {
        this.warnings.push(`sponsorships/${s.id}: no members row for ${s.bioguide}`);
        continue;
      }

      const claim = await this.cite("sponsorships", s);

      if (filled(claim)) {
        this.edge(
          "sponsored",
          `sponsored:${s.id.slice(this.bill.length + 1)}`,
          nodeId("member", s.bioguide),
          nodeId("bill", this.bill),
          [claim],
          {
            role: s.role,
            date: s.date,
            withdrawnOn: s.withdrawn_on,
          },
        );
      }
    }
  }

  private async committee(id: string): Promise<NodeId | null> {
    const key = committeeKey(id);
    const nid = nodeId("committee", key);

    if (this.nodes.has(nid)) {
      return nid;
    }

    const [c] = await this.select("committees", "upper(id) = $k", { k: key });

    if (!c) {
      return null;
    }

    this.labels.committee.set(key, c.name);
    const claim = await this.cite("committees", c);
    this.node({
      id: nid,
      kind: "committee",
      label: c.name,
      claims: filled(claim) ? [claim] : [],
      props: { chamber: c.chamber },
    });

    return nid;
  }

  private async buildCommittees() {
    const referred = await this.select("bill_committees", "bill_id = $b", { b: this.bill });

    if (referred.length === 0) {
      return;
    }

    const keys = [...new Set(referred.map((r) => committeeKey(r.committee_id)))];

    for (const k of keys) {
      await this.committee(k);
    }

    for (const r of referred) {
      const key = committeeKey(r.committee_id);

      if (!this.nodes.has(`committee:${key}`)) {
        this.warnings.push(`bill_committees/${r.id}: no committees row for ${key}`);
        continue;
      }

      const claim = await this.cite("bill_committees", r);

      if (filled(claim)) {
        this.edge("referred", `referred:${key}`, nodeId("bill", this.bill), nodeId("committee", key), [claim], {
          activity: r.activity,
        });
      }
    }

    const congress = billRef(this.bill).congress;
    const top = keys.filter((k) => k.length === 4);

    for (const m of await this.select("committee_members", "congress = $c AND list_contains($k, upper(committee_id))", {
      c: congress,
      k: top,
    })) {
      if (!this.members.has(m.bioguide)) {
        continue;
      }

      const key = committeeKey(m.committee_id);
      const claim = await this.cite("committee_members", m);

      if (filled(claim)) {
        this.edge(
          "member_of",
          `member_of:${m.bioguide}:${key}`,
          nodeId("member", m.bioguide),
          nodeId("committee", key),
          [claim],
          { role: m.role },
        );
      }
    }
  }

  private async buildAmendments(): Promise<Bundle["amendments"]> {
    const rows = await this.select("amendments", "bill_id = $b", { b: this.bill });

    for (const a of rows) {
      const n = a.number;
      this.labels.amendment.set(a.id, /^\d+$/u.test(n) ? `${a.chamber === "Senate" ? "S.Amdt." : "H.Amdt."} ${n}` : n);
    }

    const links = await this.select("amendment_sections", "list_contains($ids, amendment_id)", {
      ids: rows.map((a) => a.id),
    });

    const out: Bundle["amendments"] = [];

    for (const a of rows) {
      const claim = await this.cite("amendments", a);

      if (!filled(claim)) {
        continue;
      }

      const mine = links.filter((l) => l.amendment_id === a.id && this.sections.has(l.section_id));
      const sponsor = filled(a.sponsor_bioguide) && this.members.has(a.sponsor_bioguide) ? a.sponsor_bioguide : null;

      if (sponsor !== null) {
        this.memberIds.add(sponsor);
      }

      const byCommittee =
        sponsor === null && filled(a.sponsor_committee) ? await this.committee(a.sponsor_committee) : null;

      for (const l of mine) {
        const link = await this.cite("amendment_sections", l);

        if (filled(link)) {
          this.sections.get(l.section_id)?.claims.push(link);
        }

        if (filled(link) && sponsor !== null && a.status === "agreed" && l.effect === "inserted") {
          this.edge(
            "inserted",
            `inserted:${a.id}:${l.section_id}`,
            nodeId("member", sponsor),
            nodeId("section", l.section_id),
            [link, claim],
            {
              amendmentId: a.id,
              how: l.how,
            },
          );
        }
      }

      out.push({
        id: a.id,
        number: this.names.amendment(a.id),
        chamber: a.chamber,
        sponsor: sponsor === null ? byCommittee : nodeId("member", sponsor),
        purpose: a.purpose,
        status: a.status,
        latestAction: a.latest_action,
        latestActionOn: a.latest_action_on,
        rollId: a.roll_id,
        versionStep: a.version_step,
        url: a.url,
        sections: mine.map((l) => l.section_id),
        claim,
      });
    }

    return out;
  }

  private async buildLobbying(): Promise<Bundle["lobbying"]> {
    const live = [
      this.has("lda_filings", "superseded") ? "NOT f.superseded" : "true",
      this.has("lda_filings", "form") ? "f.form = 'LD-2'" : "true",
    ].join(" AND ");

    const refs = this.tables.has("lda_bill_refs")
      ? (
          await query(
            this.db,
            `SELECT r.* FROM lda_bill_refs r JOIN lda_filings f ON f.id = r.filing_id
           WHERE r.bill_id = $b AND r.match IN ('high', 'medium') AND ${live} ORDER BY r.id`,
            { b: this.bill },
          )
        ).map((r) => parseRow("lda_bill_refs", r))
      : [];

    for (const r of refs) {
      this.rows.set(`lda_bill_refs/${r.id}`, r);
    }

    if (this.tables.has("lda_bill_refs")) {
      this.heldOutEarlier = await countOf(
        this.db,
        "SELECT count(*)::INTEGER AS n FROM lda_bill_refs WHERE bill_id = $b AND match = 'low' AND why LIKE 'Held out: %'",
        { b: this.bill },
      );
    }

    const topicRefs = await this.select("lda_topic_refs", "bill_id = $b", { b: this.bill });
    const filingIds = [...new Set([...refs, ...topicRefs].map((r) => r.filing_id))];

    for (const f of await this.select("lda_filings", "list_contains($ids, id)", { ids: filingIds })) {
      this.filings.set(f.id, f);
    }

    const firstFiling = new Map<string, Row<"lda_filings">>();

    for (const f of this.filings.values()) {
      if (!firstFiling.has(f.client_key)) {
        firstFiling.set(f.client_key, f);
      }
    }

    const clientKeys = [...firstFiling.keys()];

    const clientRows = new Map(
      (await this.select("lda_clients", "list_contains($k, id)", { k: clientKeys })).map((c) => [c.id, c]),
    );

    for (const [key, any] of firstFiling) {
      const c = clientRows.get(key);
      this.labels.client.set(key, c?.name ?? any.client_name);
      const claim = c ? await this.cite("lda_clients", c) : null;
      this.node({
        id: nodeId("client", key),
        kind: "client",
        label: c?.name ?? any.client_name,
        claims: filled(claim) ? [claim] : [],
        props: {
          names: c?.names ?? [any.client_name],
          ldaClientIds: c?.lda_client_ids ?? [any.lda_client_id],
          description: c?.description ?? any.client_description ?? null,
        },
      });
    }

    const spendRows = await this.select("lda_spend", "bill_id = $b", { b: this.bill });

    const spend = spendRows.map((s): CitedRow<"lda_spend"> => ({
      ...s,
      share_usd: null,
      amounts: filled(s.client_key)
        ? counted(s)
        : spendRows
            .filter((x) => filled(x.client_key) && x.topic_only === s.topic_only)
            .reduce((n, x) => n + counted(x), 0),
    }));

    const spendClaims = async (s: CitedRow<"lda_spend"> | undefined) => ({
      total: s === undefined || missing(s.total_usd) ? null : await this.cite("lda_spend", s, "total"),
      share: s === undefined || missing(s.share_usd) ? null : await this.cite("lda_spend", s, "share"),
    });

    const spendOf = (key: string | null, topic: boolean) =>
      spend.find((s) => s.client_key === key && s.topic_only === topic);

    const byClient = groupBy(refs, (r) => this.filing(r.filing_id).client_key);

    for (const [key, rs] of byClient) {
      const s = spendOf(key, false);
      const { total, share } = await spendClaims(s);
      const claims = [total, ...(await this.cites("lda_bill_refs", rs))].filter(filled);
      const sectionNums = new Set(rs.flatMap((r) => r.section_nums));
      this.edge(
        "lobbied",
        `lobbied:${key}`,
        nodeId("client", key),
        nodeId("bill", this.bill),
        claims,
        s ? { ...spendProps(s, false), shareClaim: share } : this.refProps(rs, false),
      );

      for (const num of sectionNums) {
        const target = this.sectionByNum(num);

        if (target === undefined) {
          continue;
        }

        const named = rs.filter((r) => r.section_nums.includes(num));
        this.edge(
          "lobbied",
          `lobbied:${key}:${target}`,
          nodeId("client", key),
          nodeId("section", target),
          await this.cites("lda_bill_refs", named),
          this.refProps(named, false),
        );
      }
    }

    for (const [key, rs] of groupBy(topicRefs, (r) => this.filings.get(r.filing_id)?.client_key ?? "")) {
      if (key === "") {
        continue;
      }

      const s = spendOf(key, true);
      const { total, share } = await spendClaims(s);
      const claims = [total, ...(await this.cites("lda_topic_refs", rs))].filter(filled);
      this.edge(
        "lobbied",
        `lobbied:topic:${key}`,
        nodeId("client", key),
        nodeId("bill", this.bill),
        claims,
        s ? { ...spendProps(s, true), shareClaim: share } : this.refProps(rs, true),
      );
    }

    const namedFilings = [...new Set(refs.map((r) => r.filing_id))].map((id) => this.filing(id));

    for (const fs of groupBy(namedFilings, (f) => `${f.client_key}|${f.registrant_id}`).values()) {
      const [{ client_key: key, registrant_id: reg, registrant_name: label }] = fs;
      this.node({
        id: nodeId("registrant", reg),
        kind: "registrant",
        label,
        claims: [],
        props: { ldaId: reg },
      });
      this.edge(
        "hired",
        `hired:${key}:${reg}`,
        nodeId("client", key),
        nodeId("registrant", reg),
        await this.cites("lda_filings", fs),
        { reports: fs.length },
      );
    }

    const lobbyists = await this.select("lda_lobbyists", "list_contains($ids, filing_id)", {
      ids: namedFilings.map((f) => f.id),
    });

    const covered = lobbyists.filter(
      (l) =>
        filled(l.covered_position) &&
        !NO_POSITION.test(l.covered_position.trim()) &&
        (l.bill_ids.length === 0 || l.bill_ids.includes(this.bill)),
    );

    if (covered.length > 0) {
      this.rulesUsed.add("lobbyist-nodes");
    }

    for (const [lid, ls] of groupBy(covered, (l) => l.lobbyist_id)) {
      const positions = new Map<string, ClaimId>();

      for (const l of ls) {
        const claim = await this.cite("lda_lobbyists", l);
        const position = l.covered_position ?? "";

        if (filled(claim) && !positions.has(position)) {
          positions.set(position, claim);
        }
      }

      this.node({
        id: nodeId("lobbyist", lid),
        kind: "lobbyist",
        label: ls[0].name,
        claims: [],
        props: { ldaId: lid, coveredPositions: [...positions].map(([quote, claim]) => ({ quote, claim })) },
      });

      for (const [reg, rs] of groupBy(ls, (l) => this.filing(l.filing_id).registrant_id)) {
        this.edge(
          "employs",
          `employs:${reg}:${lid}`,
          nodeId("registrant", reg),
          nodeId("lobbyist", lid),
          await this.cites("lda_lobbyists", rs),
          { reports: new Set(rs.map((r) => r.filing_id)).size },
        );
      }
    }

    const whole = spendOf(null, false);
    const phases = { bill: 0, enactmentQuarter: 0, law: 0 };
    const phaseOf = new Map(refs.map((r) => [r.filing_id, r.phase]));

    for (const p of phaseOf.values()) {
      phases[p === "law" ? "law" : p === "enactment-quarter" ? "enactmentQuarter" : "bill"]++;
    }

    return {
      reports: namedFilings.length,
      clients: byClient.size,
      registrants: new Set(namedFilings.map((f) => f.registrant_id)).size,
      lobbyists: new Set(lobbyists.map((l) => l.lobbyist_id)).size,
      byPhase: phases,
      spendTotalUsd: whole?.total_usd ?? null,
      shareEstimateUsd: whole?.share_usd ?? null,
      claims: Object.values(await spendClaims(whole)).filter(filled),
    };
  }

  private filing(id: string): Row<"lda_filings"> {
    const f = this.filings.get(id);

    if (!f) {
      throw new Error(`${this.bill}: lobbying filing ${id} is named but not loaded`);
    }

    return f;
  }

  private sectionByNum(num: string): string | undefined {
    const all = [...this.sections.values()].filter((s) => s.num === num);

    return (all.find((s) => s.inFinal) ?? all[0])?.id;
  }

  private refProps(rs: BillRef[], topicOnly: boolean): EdgeOf<"lobbied">["props"] {
    const filings = [...new Set(rs.map((r) => r.filing_id))].flatMap((id) => this.filings.get(id) ?? []);

    const phase = (p: string) => new Set(rs.flatMap((r) => (r.phase === p ? [r.filing_id] : []))).size;

    return {
      reports: filings.length,
      quarters: new Set(filings.map((f) => `${f.year}${f.period}`)).size,
      phases: { bill: phase("bill"), enactmentQuarter: phase("enactment-quarter"), law: phase("law") },
      spendTotalUsd: null,
      shareEstimateUsd: null,
      issueQuote: (rs.find((r) => "section_nums" in r && r.section_nums.length > 0) ?? rs[0])?.quote ?? null,
      topicOnly,
    };
  }

  private async buildCompanies(): Promise<Map<string, string>> {
    const benefits = await this.select("benefits", "bill_id = $b", { b: this.bill });
    const clientSrcs = [...this.nodes.keys()].filter((k) => k.startsWith("client:"));

    const resolutions = (await this.select("resolutions", "list_contains($s, src)", { s: clientSrcs })).filter((r) =>
      this.ownedWhenFiled(r),
    );

    await this.addCompanies([...benefits, ...resolutions].map((r) => r.company_id));

    for (const r of resolutions) {
      if (!this.nodes.has(`company:${r.company_id}`)) {
        continue;
      }

      const claim = await this.cite("resolutions", r);
      const src = NodeIdSchema.safeParse(r.src);

      if (filled(claim) && src.success) {
        this.edge("resolves_to", `resolves_to:${r.src}`, src.data, nodeId("company", r.company_id), [claim], {
          method: r.method,
          reason: reasonOf(r),
        });
      }
    }

    const tied = new Map<string, string>();

    for (const b of benefits) {
      if (!this.nodes.has(`company:${b.company_id}`)) {
        continue;
      }

      const src =
        filled(b.section_id) && this.sections.has(b.section_id)
          ? nodeId("section", b.section_id)
          : nodeId("bill", this.bill);

      const claim = await this.cite("benefits", b);

      if (!filled(claim)) {
        continue;
      }

      this.edge("benefits", `benefits:${src}:${b.company_id}`, src, nodeId("company", b.company_id), [claim], {
        rule: b.basis_rule,
      });
      const company = this.nodes.get(`company:${b.company_id}`);

      for (const t of company?.kind === "company" ? company.props.tickers : []) {
        tied.set(t.toUpperCase(), b.company_id);
      }
    }

    if (benefits.length > 0) {
      this.rulesUsed.add("tied-stock");
    }

    return tied;
  }

  private lobbyingHeads(): Map<string, Set<string>> {
    const heads = new Map<string, Set<string>>();

    for (const e of this.edges.values()) {
      if (e.kind !== "resolves_to" || !e.src.startsWith("client:")) {
        continue;
      }

      const company = e.dst.slice(8);
      const set = getOrSet(heads, company, () => new Set<string>());
      const head = headOf(this.labels.client.get(e.src.slice(7)) ?? "");

      if (head !== "") {
        set.add(head);
      }
    }

    return heads;
  }

  private ownedWhenFiled(r: Row<"resolutions">): boolean {
    const since = ownedSince(reasonOf(r));

    if (!filled(since) || !r.src.startsWith("client:")) {
      return true;
    }

    const key = r.src.slice(7);

    return [...this.filings.values()].some((f) => f.client_key === key && ownedOn(since, f.period_end));
  }

  private async addCompanies(ids: string[]) {
    const want = [...new Set(ids)].filter((id) => !this.nodes.has(`company:${id}`));

    for (const c of await this.select("companies", "list_contains($ids, id)", { ids: want })) {
      this.labels.company.set(c.id, c.tickers.length > 0 ? `${c.name} (${c.tickers.join(", ")})` : c.name);
      const claim = await this.cite("companies", c);
      this.node({
        id: nodeId("company", c.id),
        kind: "company",
        label: c.name,
        claims: filled(claim) ? [claim] : [],
        props: { cik: c.id, tickers: c.tickers, secUrl: c.source_url },
      });
    }

    for (const id of want) {
      if (!this.nodes.has(`company:${id}`)) {
        this.warnings.push(`company ${id}: no companies row`);
      }
    }
  }

  private async buildTrades(tied: Map<string, string>, w: { tradeFrom: string; tradeTo: string }) {
    if (!tied.size) {
      return;
    }

    this.rulesUsed.add("trade-window");

    const trades = await this.select(
      "trades",
      "list_contains($t, upper(ticker)) AND traded_on BETWEEN $from AND $to",
      {
        t: [...tied.keys()],
        from: w.tradeFrom,
        to: w.tradeTo,
      },
      "traded_on",
    );

    const matching = trades.filter((t) => !reusedTicker(t.ticker, t.asset));

    if (matching.length < trades.length) {
      this.warnings.push(
        `${trades.length - matching.length} trades left out: the ticker belonged to a different company`,
      );
    }

    const fits = matching.filter((t) => securityOf(t.asset_type, t.asset) === "stock");

    for (const t of matching) {
      const kind = securityOf(t.asset_type, t.asset);

      if (kind !== "stock") {
        this.nonStock[kind]++;
      }
    }

    const known = fits.filter((t) => filled(t.bioguide) && this.members.has(t.bioguide));

    if (known.length < fits.length) {
      this.warnings.push(`${fits.length - known.length} trades in tied stocks are from filers not matched to a member`);
    }

    for (const [pair, ts] of groupBy(known, (t) => `${t.bioguide}|${tied.get((t.ticker ?? "").toUpperCase())}`)) {
      const [bioguide = "", company = ""] = pair.split("|");
      const events: EdgeOf<"traded">["props"]["events"] = [];

      for (const t of ts) {
        const claim = await this.cite("trades", t);

        if (filled(claim) && filled(t.traded_on)) {
          events.push({
            date: t.traded_on,
            type: t.type,
            amount: t.amount,
            owner: t.owner,
            ticker: t.ticker,
            asset: t.asset,
            readBy: t.read_by,
            nameMatch: nameMatches(t.asset, this.nodes.get(`company:${company}`)?.label ?? ""),
            claim,
          });
        }
      }

      if (events.length > 0) {
        this.edge(
          "traded",
          `traded:${bioguide}:${company}`,
          nodeId("member", bioguide),
          nodeId("company", company),
          events.map((e) => e.claim),
          { events },
        );
      }
    }
  }

  private async buildMoney(tied: Map<string, string>, w: { cycles: number[]; end: string }) {
    const companies = [...new Set(tied.values())];

    if (companies.length === 0) {
      return;
    }

    const found = await this.select("resolutions", "src LIKE 'pac:%' AND list_contains($c, company_id)", {
      c: companies,
    });

    const allPacs = await this.select("pacs", "list_contains($ids, id)", {
      ids: [...new Set(found.map((r) => r.src.slice(4)))],
    });

    const pacName = new Map(allPacs.map((p) => [p.id, p.name]));
    const lobbyingHeads = this.lobbyingHeads();

    const res = found.filter((r) => {
      if (OWN_PAC.has(r.method)) {
        return true;
      }

      const head = headOf(pacName.get(r.src.slice(4)) ?? "");

      return head !== "" && (lobbyingHeads.get(r.company_id)?.has(head) ?? false);
    });

    const subsidiaryOf = new Map(res.filter((r) => !OWN_PAC.has(r.method)).map((r) => [r.src.slice(4), r.company_id]));
    const since = new Map(res.map((r) => [r.src.slice(4), ownedSince(reasonOf(r))]));
    const pacs = allPacs.filter((p) => res.some((r) => r.src === `pac:${p.id}`));

    for (const p of pacs) {
      this.labels.pac.set(p.id, p.name);
      const claim = await this.cite("pacs", p);
      this.node({
        id: nodeId("pac", p.id),
        kind: "pac",
        label: p.name,
        claims: filled(claim) ? [claim] : [],
        props: { fecId: p.id, connectedOrg: p.connected_org, subsidiaryOf: subsidiaryOf.get(p.id) ?? null },
      });
    }

    for (const r of res) {
      const src = NodeIdSchema.safeParse(r.src);

      if (!src.success || !this.nodes.has(src.data)) {
        continue;
      }

      const claim = await this.cite("resolutions", r);

      if (filled(claim)) {
        this.edge("resolves_to", `resolves_to:${r.src}`, src.data, nodeId("company", r.company_id), [claim], {
          method: r.method,
          reason: reasonOf(r),
        });
      }
    }

    if (pacs.length === 0) {
      return;
    }

    this.rulesUsed.add("tied-donors");
    this.rulesUsed.add("donor-window");

    const gifts = await this.select(
      "contributions",
      "list_contains($p, pac_id) AND bioguide IS NOT NULL AND list_contains($c, cycle)",
      {
        p: pacs.map((p) => p.id),
        c: w.cycles,
      },
      "date",
    );

    for (const [pair, gs] of groupBy(
      gifts.filter(
        (g) => filled(g.bioguide) && this.members.has(g.bioguide) && ownedOn(since.get(g.pac_id) ?? null, g.date),
      ),
      (g) => `${g.pac_id}|${g.bioguide}`,
    )) {
      const [pac = "", bioguide = ""] = pair.split("|");
      const periods = w.cycles.map((c) => `&two_year_transaction_period=${c}`).join("");
      const recipients = [...new Set(gs.map((g) => g.recipient_committee_id).filter(filled))];
      const to = recipients.length === 1 ? `&recipient_committee_id=${recipients[0]}` : "";
      const cutoff = this.votedOn.get(bioguide) ?? w.end;
      const before = gs.filter((g) => g.date <= cutoff);
      this.edge(
        "funded",
        `funded:${pac}:${bioguide}`,
        nodeId("pac", pac),
        nodeId("member", bioguide),
        await this.cites("contributions", gs),
        {
          cutoff,
          cutoffKind: this.votedOn.has(bioguide) ? "vote" : "enactment",
          beforeUsd: sum(before),
          afterUsd: sum(gs) - sum(before),
          amountUsd: sum(gs),
          contributions: gs.length,
          first: gs[0].date,
          last: (gs.at(-1) ?? gs[0]).date,
          allTxnsUrl: `https://www.fec.gov/data/disbursements/?data_type=processed&committee_id=${pac}${to}${periods}`,
        },
      );
    }
  }

  private async attentionSample(): Promise<{ found: number; relevant: number }> {
    const [row] = await this.select("attention", "bill_id = $b AND evidence IS NOT NULL", { b: this.bill });

    const found = row?.evidence.found_by_side;
    const relevant = row?.evidence.relevant_by_side;

    return { found: isCounts(found) ? sumOf(found) : 0, relevant: isCounts(relevant) ? sumOf(relevant) : 0 };
  }

  private async buildAttention(): Promise<Bundle["attention"]> {
    const rows = await this.select("attention", "bill_id = $b", { b: this.bill });

    const articles = this.tables.has("articles")
      ? (
          await query(
            this.db,
            `SELECT a.*, o.name AS outlet_name, o."group" AS outlet_group, o.list_version
           FROM articles a LEFT JOIN outlets o ON o.id = a.outlet_id WHERE a.bill_id = $b ORDER BY a.id`,
            { b: this.bill },
          )
        ).map((r) => ArticleWithOutlet.parse(r))
      : [];

    const byId = new Map(articles.map((a) => [a.id, a]));

    const shape = async (r: Row<"attention">): Promise<Section["attention"]> => {
      const claim = await this.cite("attention", r);

      if (!filled(claim)) {
        return null;
      }

      const examples: NonNullable<Section["attention"]>["examples"] = [];

      for (const id of r.example_article_ids) {
        const a = byId.get(id);

        if (!a) {
          continue;
        }

        const { outlet_name, outlet_group, list_version: _listVersion, ...row } = a;
        const c = await this.cite("articles", { ...row, outlet_name });

        if (filled(c)) {
          examples.push({
            url: a.url,
            outlet: outlet_name ?? new URL(a.url).hostname,
            group: outlet_group ?? "unlisted",
            title: a.title,
            date: a.published_on,
            claim: c,
          });
        }
      }

      const groups = Object.fromEntries(
        Object.entries(r.hits_by_group).filter(
          (e): e is [string, number] => OutletGroup.safeParse(e[0]).success && isNumber(e[1]),
        ),
      );

      return { hits: r.hits, pct: r.pct, hitsByGroup: groups, tradeLegalHits: r.trade_legal_hits, examples, claim };
    };

    let general: Section["attention"] = null;

    for (const r of rows) {
      const section = filled(r.section_id) ? this.sections.get(r.section_id) : undefined;

      if (missing(r.section_id)) {
        general = await shape(r);
      } else if (filled(r.part_id)) {
        const part = this.parts.get(r.part_id);

        if (part) {
          part.attention = await shape(r);
        }
      } else if (section) {
        section.attention = await shape(r);
      }
    }

    const dates = articles
      .map((a) => a.published_on)
      .filter(filled)
      .toSorted();

    const [firstDate] = dates;
    const lastDate = dates.at(-1);

    return {
      via: [...new Set(articles.map((a) => a.via))].toSorted(),
      outletListVersion: articles.find((a) => filled(a.list_version))?.list_version ?? null,
      window: firstDate !== undefined && lastDate !== undefined ? [firstDate, lastDate] : null,
      articles: articles.length,
      sample: this.names.sample.relevant === 0 ? null : this.names.sample,
      general,
    };
  }

  private async buildScores() {
    for (const s of await this.select("section_scores", "bill_id = $b", { b: this.bill })) {
      const section = filled(s.part_id) ? this.parts.get(s.part_id) : this.sections.get(s.section_id);
      const claim = section ? await this.cite("section_scores", s) : null;

      if (!section || !filled(claim)) {
        continue;
      }

      section.score = {
        label: s.label,
        buried: s.buried,
        offsets: s.offsets_section_id,
        components: {
          dollarsMusd: s.dollars_musd,
          dollarsSplit: s.dollars_split,
          attentionPct: s.attention_pct,
          attentionShare: s.attention_share,
          attentionChecked: s.attention_checked,
          late: s.late,
          lateClearedBy: s.late_cleared_by,
          offTopic: s.off_topic,
          lobbyingReports: s.lobbying_reports,
          lobbyingFirms: s.lobbying_firms,
          reach: s.reach,
        },
        claim,
      };
    }
  }

  private async buildMembers(w: { tradeFrom: string; tradeTo: string }) {
    const unread = await this.select(
      "ptr_documents",
      "read_status <> 'read' AND bioguide IS NOT NULL AND (filed_on IS NULL OR filed_on BETWEEN $from AND $to)",
      { from: w.tradeFrom, to: w.tradeTo },
    );

    const unreadIds = new Set(unread.map((d) => d.bioguide).filter(filled));

    for (const id of this.memberIds) {
      const m = this.members.get(id);

      if (!m) {
        throw new Error(`${this.bill}: an edge names member ${id}, who has no members row`);
      }

      const claim = await this.cite("members", m, m.term?.start ?? null);
      this.node({
        id: nodeId("member", id),
        kind: "member",
        label: memberLabel(m),
        claims: filled(claim) ? [claim] : [],
        props: {
          bioguide: id,
          party: m.party,
          state: m.state,
          district: m.district,
          chamber: m.chamber,
          paperFilingsUnread: unreadIds.has(id),
        },
      });
    }

    const members = [...unreadIds].flatMap((id) => this.members.get(id) ?? []);
    const by = (party: string) => members.filter((m) => m.party === party).length;

    return {
      members,
      byParty: { R: by("R"), D: by("D"), I: by("I") },
      loaded: this.tables.has("ptr_documents") && (await this.count("ptr_documents")) > 0,
    };
  }

  private async count(table: string) {
    return await countOf(this.db, `SELECT count(*)::INTEGER AS n FROM ${table}`);
  }

  private async buildGaps(x: {
    dollars: Bundle["dollars"];
    attention: Bundle["attention"];
    lobbying: Bundle["lobbying"];
    unread: { members: Member[]; byParty: Record<"R" | "D" | "I", number>; loaded: boolean };
    sections: Section[];
  }): Promise<Bundle["gaps"]> {
    const gaps: Bundle["gaps"] = [];

    const gap = (
      id: string,
      kind: Bundle["gaps"][number]["kind"],
      text: string,
      nodes: NodeId[] = [],
      claim: ClaimId | null = null,
    ) => gaps.push({ id, kind, text, nodes, claim });

    if (filled(this.lateUnavailable)) {
      gap("late-unavailable", "late_unavailable", `Late flag unavailable: ${this.lateUnavailable}`);
    }

    if (!x.unread.loaded) {
      gap("trades-not-loaded", "other", "Member trade filings aren't loaded yet, so no trades show here.");
    } else if (x.unread.members.length > 0) {
      const by = (p: string) => x.unread.members.filter((m) => m.party === p).length;
      gap(
        "paper-ptrs",
        "paper_filings_unread",
        `Paper filings not yet read: ${count(x.unread.members.length, "member")} (${by("R")} R, ${by("D")} D, ${by("I")} I) filed trade reports in this bill's window that haven't been read, so their trades may be missing here.`,
        x.unread.members.map((m) => nodeId("member", m.id)).filter((id) => this.nodes.has(id)),
      );
    }

    const { estimates } = x.dollars;
    const [firstEstimate] = estimates;

    if (firstEstimate === undefined) {
      gap(
        "no-cbo",
        "no_section_dollars",
        "No CBO cost estimate is loaded for this bill, so no dollar figures show here.",
      );
    } else if (!estimates.some((e) => e.perSection) && !x.sections.some((s) => s.dollars.length)) {
      gap(
        "no-section-dollars",
        "no_section_dollars",
        "CBO published whole-bill numbers only for this bill, so no section has its own dollar figure.",
        [],
        firstEstimate.claim,
      );
    }

    if (x.attention.articles === 0) {
      gap("no-attention", "attention_partial", "News attention isn't measured for this bill yet.");
    } else if (!x.attention.via.includes("mediacloud")) {
      gap(
        "attention-gnews",
        "attention_partial",
        "News attention here comes from Google News only, not from the counted Media Cloud outlet list.",
      );
    }

    if (!this.tables.has("lda_bill_refs") || (await this.count("lda_bill_refs")) === 0) {
      gap("no-lobbying", "other", "Lobbying filings aren't loaded yet, so no lobbying shows here.");
    } else if (x.lobbying.clients !== 0) {
      const clients = [...this.nodes.keys()].filter(
        (k) => k.startsWith("client:") && this.edges.has(`lobbied:${k.slice(7)}`),
      );

      const resolved = clients.filter((c) => this.edges.has(`resolves_to:${c}`));

      const reports = (c: string) => {
        const e = this.edges.get(`lobbied:${c.slice(7)}`);

        return e?.kind === "lobbied" ? e.props.reports : 0;
      };

      const loose = clients
        .filter((c) => !this.edges.has(`resolves_to:${c}`))
        .toSorted((a, b) => reports(b) - reports(a) || a.localeCompare(b))
        .slice(0, 12)
        .map((c) => `${this.labels.client.get(c.slice(7)) ?? c.slice(7)} (${reports(c)})`);

      gap(
        "entity-recall",
        "entity_recall",
        `${resolved.length} of the ${count(clients.length, "client")} that named this bill were matched to an SEC-listed company. The rest were not matched: many are trade groups, nonprofits and private firms, but some may be listed companies the matcher missed, and members' trades in those are not marked as tied. Unmatched with the most reports: ${loose.join("; ")}.`,
      );
    }

    const optionsAndBonds = this.nonStock.option + this.nonStock.bond + this.nonStock.other;

    if (optionsAndBonds !== 0) {
      gap(
        "non-stock-trades",
        "other",
        `${optionsAndBonds.toLocaleString("en-US")} trades in tied companies were options (${this.nonStock.option}), bonds (${this.nonStock.bond}) or other securities (${this.nonStock.other}). An option or a bond is not a share of the company, so they are not counted as stock trades.`,
      );
    }

    if (this.heldOutEarlier !== 0) {
      gap(
        "earlier-bill",
        "other",
        `${count(this.heldOutEarlier, "lobbying line")} on this bill number were held out because they are about the Build Back Better Act, which used the number until the Senate replaced its text on 2022-07-27: filings for earlier periods and lines that call it Build Back Better.`,
      );
    }

    const removed = this.warnings.filter((w) => w.includes("not matched to a member"));

    if (removed.length > 0) {
      gap("unmatched-filers", "entity_recall", removed.join("; "));
    }

    return gaps;
  }
}

export function servedIn(m: Member, congress: number): boolean {
  const from = `${1789 + 2 * (congress - 1)}-01-03`;
  const to = `${1789 + 2 * congress}-01-02`;

  return m.terms.length === 0 || m.terms.some((t) => t.start <= to && t.end >= from);
}

const PARTY_LETTER = new Map<string, "R" | "D" | "I">([
  ["Republican", "R"],
  ["Democrat", "D"],
  ["Democratic", "D"],
]);

export function asOf(m: Member, on: string): Member {
  const { terms } = m;
  const term = terms.find((t) => t.start <= on && on <= t.end) ?? terms.findLast((t) => t.start <= on);

  if (!term) {
    return m;
  }

  const party = PARTY_LETTER.get(term.party) ?? "I";

  return { ...m, party, state: term.state, district: term.district, chamber: term.chamber, term };
}

function step(f: Fields): Section["history"][string] {
  return SectionStep.parse({
    path: f.path ?? "",
    heading: f.heading ?? "",
    words: f.words ?? 0,
    match: f.match ?? null,
    similarity: f.similarity ?? null,
    wordsAdded: f.wordsAdded ?? f.words_added ?? null,
    wordsRemoved: f.wordsRemoved ?? f.words_removed ?? null,
    largestInserts: f.largestInserts ?? f.largest_inserts ?? [],
  });
}

export function vehicleNote(
  lateUnavailable: string | null,
  versions: Bundle["versions"],
  sections: Section[],
  sponsor: Pick<Member, "name"> | undefined,
): string | null {
  if (!sponsor || versions.some((v) => v.predecessor)) {
    return null;
  }

  const first = versions.find((v) => filled(v.date))?.code ?? versions[0]?.code;
  const final = sections.filter((s) => s.inFinal);
  const carried = final.length > 0 ? final.filter((s) => s.firstVersion === first).length / final.length : 1;

  if (!filled(lateUnavailable) && carried >= 0.5) {
    return null;
  }

  return `${Math.round((1 - carried) * 100)}% of the law's sections were not in the bill ${sponsor.name} introduced. It was a vehicle: the law's text came from later versions, so this sponsor did not write the law.`;
}

function spendProps(s: CitedRow<"lda_spend">, topicOnly: boolean): EdgeOf<"lobbied">["props"] {
  return {
    reports: s.reports,
    quarters: s.quarters,
    phases: { bill: s.reports_bill, enactmentQuarter: s.reports_enactment_quarter, law: s.reports_law },
    spendTotalUsd: s.total_usd,
    shareEstimateUsd: null,
    issueQuote: s.issue_quote,
    topicOnly,
  };
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, [T, ...T[]]> {
  const groups = new Map<string, [T, ...T[]]>();

  for (const x of xs) {
    const k = key(x);
    const group = groups.get(k);

    if (group) {
      group.push(x);
    } else {
      groups.set(k, [x]);
    }
  }

  return groups;
}

function getOrSet<K, V>(map: Map<K, V>, key: K, make: () => V): V {
  const found = map.get(key);

  if (found !== undefined) {
    return found;
  }

  const made = make();
  map.set(key, made);

  return made;
}

const orElse = (text: string, fallback: () => string) => (text === "" ? fallback() : text);

const sum = (list: Row<"contributions">[]) => list.reduce((a, g) => a + g.amount_usd, 0);

const reasonOf = (r: Row<"resolutions">) => (isText(r.evidence.reason) ? r.evidence.reason : null);
