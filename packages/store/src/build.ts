import {
  type BillId,
  type Bundle,
  Bundle as BundleSchema,
  billDisplay,
  billRef,
  billstatusUrl,
  type Claim,
  type ClaimId,
  checkBundle,
  congressGovUrl,
  type Dollar,
  type Edge,
  type EdgeKind,
  type EdgeOf,
  lobbyingQuery,
  type Node,
  type NodeId,
  nodeId,
  OutletGroup,
  type Section,
} from "@antibody/core";
import { type AnyRow, mintClaim, type Names, restsOnOf } from "./claims.ts";
import { type Db, type Param, query, tableNames } from "./db.ts";
import { limitGraph } from "./limit.ts";
import { ruleFor } from "./rules.ts";
import { count, day, lawNumber, memberLabel, quarter } from "./text.ts";
import { nameMatches, reusedTicker } from "./trades.ts";
import { trimEvidence } from "./trim.ts";

export interface BuildResult {
  bundle: Bundle;
  /** Rows the builder had to leave out, with why (an unknown member, a claim that failed validation…). */
  warnings: string[];
}

/** What filers type in the covered-position box when they have none. */
const NO_POSITION = /^(?:n\/?a|none|no|yes|nil|see form ld-?1.*|[-.\s]*)\.?$/i;

export class BuildError extends Error {}

const YEAR = 365 * 24 * 3600 * 1000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const PASSAGE = /pass|concur|conference report|veto/i;
/** Thomas committee ids: BILLSTATUS writes `ssbk00`, congress-legislators `SSBK`; subcommittees keep their suffix. */
const committeeKey = (id: string) => id.toUpperCase().replace(/^([A-Z]{4})00$/, "$1");

/**
 * Builds one bill's Bundle from the contract tables loaded in `db` (see `loadTables`). Every statement in the
 * bundle points at a claim minted from the row that states it, with one wording template per table, so the
 * text is the same for every party. Missing tables or rows become `gaps`, never invented data.
 */
export async function buildBundle(db: Db, bill: BillId, { now = new Date() } = {}): Promise<BuildResult> {
  return new Builder(db, bill, now).build();
}

class Builder {
  private claims = new Map<ClaimId, Claim>();
  private rows = new Map<string, AnyRow>();
  private nodes = new Map<NodeId, Node>();
  private edges = new Map<string, Edge>();
  private warnings: string[] = [];
  private tables = new Set<string>();
  private cols = new Map<string, Set<string>>();
  private members = new Map<string, AnyRow>();
  private memberIds = new Set<string>();
  private sections = new Map<string, Section>();
  private versionNames = new Map<string, string>();
  private filings = new Map<string, AnyRow>();
  private labels = {
    company: new Map<string, string>(),
    pac: new Map<string, string>(),
    client: new Map<string, string>(),
    committee: new Map<string, string>(),
    roll: new Map<string, string>(),
    amendment: new Map<string, string>(),
    estimate: new Map<string, AnyRow>(),
  };
  private rulesUsed = new Set<string>();
  /** The date of each member's first recorded passage vote (not "Not Voting"). */
  private votedOn = new Map<string, string>();
  private lateUnavailable: string | null = null;
  private display: string;

  constructor(
    private db: Db,
    private bill: BillId,
    private now: Date,
  ) {
    this.display = billDisplay(bill);
  }

  private names: Names = {
    bill: "",
    display: "",
    member: (b) => {
      const m = b ? this.members.get(b) : undefined;
      return m ? { name: m.name, party: m.party, state: m.state, chamber: m.chamber } : null;
    },
    section: (id) => (id ? (this.sections.get(id) ?? null) : null),
    version: (code) => (code ? (this.versionNames.get(code) ?? code) : "unknown"),
    company: (id) => this.labels.company.get(id) ?? `the company with SEC CIK ${id}`,
    pac: (id) => this.labels.pac.get(id) ?? `FEC committee ${id}`,
    client: (key) => this.labels.client.get(key) ?? key,
    filing: (id) => {
      const f = this.filings.get(id);
      return f
        ? { registrant: f.registrant_name, client: f.client_name, when: `${quarter(f.period)} ${f.year}` }
        : null;
    },
    lobbyingList: (key) => {
      const node = key ? this.nodes.get(`client:${key}`) : null;
      const id = node?.kind === "client" ? node.props.ldaClientIds[0] : null;
      if (key && !id) return undefined;
      const q = new URLSearchParams({
        ...(id && { client_id: String(id) }),
        filing_specific_lobbying_issues: lobbyingQuery(this.bill),
      });
      return `https://lda.gov/api/v1/filings/?${q}`;
    },
    clientFiling: (key) => [...this.filings.values()].find((f) => f.client_key === key)?.url,
    committee: (id) => this.labels.committee.get(committeeKey(id)) ?? `committee ${id}`,
    roll: (id) => this.labels.roll.get(id) ?? `roll call ${id}`,
    amendment: (id) => this.labels.amendment.get(id) ?? `Amendment ${id}`,
    estimate: (id) => this.labels.estimate.get(id) ?? null,
  };

  // ── rows and claims ──

  /** Rows come back in a total order (`order`, then id) because DuckDB's own order is unspecified and bundles must rebuild byte for byte. */
  private async select(
    table: string,
    where = "true",
    params?: Record<string, Param>,
    order?: string,
  ): Promise<AnyRow[]> {
    if (!this.tables.has(table)) return [];
    const by = order ? `${order}, id` : "id";
    const rows = await query<AnyRow>(this.db, `SELECT * FROM ${table} WHERE ${where} ORDER BY ${by}`, params);
    for (const r of rows) this.rows.set(`${table}/${r.id}`, r);
    return rows;
  }

  private has(table: string, column: string) {
    return this.cols.get(table)?.has(column) ?? false;
  }

  /** Mints the claim for a row (once) and returns its id, or null when the row can't back a claim. */
  private async cite(table: string, row: AnyRow, facet: string | null = null): Promise<ClaimId | null> {
    const id = `${table}/${row.id}${facet ? `#${facet}` : ""}`;
    if (this.claims.has(id)) return id;
    this.rows.set(`${table}/${row.id}`, row);
    try {
      this.claims.set(id, PENDING);
      const restsOn = await this.resolve(restsOnOf(table, row, facet, this.names), id);
      const claim = mintClaim(table, row, facet, this.names, restsOn, (ids) =>
        ids.map((x) => this.claims.get(x)?.sourceUrl).find(Boolean),
      );
      if (claim.kind === "inference" && claim.rule) this.rulesUsed.add(claim.rule);
      this.claims.set(id, claim);
      return id;
    } catch (e) {
      this.claims.delete(id);
      this.warnings.push(`claim ${id}: ${(e as Error).message.split("\n")[0]}`);
      return null;
    }
  }

  /** Keeps the restsOn ids that resolve to a row (minting their claims), drops and reports the rest. */
  private async resolve(ids: ClaimId[], from: ClaimId): Promise<ClaimId[]> {
    const out: ClaimId[] = [];
    for (const id of ids) {
      if (id === from) continue;
      if (this.claims.has(id) || (await this.ensure(id))) out.push(id);
      else this.warnings.push(`claim ${from}: rests on ${id}, which isn't in the tables`);
    }
    return out;
  }

  /** Finds the row behind a claim id `<table>/<row id>[#facet]` (row ids may themselves contain `#`). */
  private async ensure(id: ClaimId): Promise<boolean> {
    const slash = id.indexOf("/");
    const table = id.slice(0, slash);
    const rest = id.slice(slash + 1);
    const cuts = [rest.length, ...[...rest.matchAll(/#/g)].map((m) => m.index!).reverse()];
    for (const cut of cuts) {
      const rowId = rest.slice(0, cut);
      const facet = cut < rest.length ? rest.slice(cut + 1) : null;
      const row = this.rows.get(`${table}/${rowId}`) ?? (await this.select(table, "id = $id", { id: rowId }))[0];
      if (row) return (await this.cite(table, row, facet)) !== null;
    }
    return false;
  }

  private async cites(table: string, rows: AnyRow[], facet: string | null = null): Promise<ClaimId[]> {
    const ids: ClaimId[] = [];
    for (const r of rows) {
      const id = await this.cite(table, r, facet);
      if (id) ids.push(id);
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
    if (!ok.length) {
      this.warnings.push(`edge ${id}: no claim backs it, left out`);
      return;
    }
    const basis = ok.some((c) => this.claims.get(c)!.kind === "inference") ? "inference" : "fact";
    for (const end of [src, dst]) if (end.startsWith("member:")) this.memberIds.add(end.slice(7));
    this.edges.set(id, { id, kind, src, dst, basis, claims: [...new Set(ok)], props } as Edge);
  }

  private node(n: Node) {
    if (!this.nodes.has(n.id)) this.nodes.set(n.id, n);
  }

  // ── the build ──

  async build(): Promise<BuildResult> {
    this.tables = await tableNames(this.db);
    for (const r of await query<{ t: string; c: string }>(
      this.db,
      "SELECT table_name AS t, column_name AS c FROM duckdb_columns()",
    ))
      (this.cols.get(r.t) ?? this.cols.set(r.t, new Set()).get(r.t)!).add(r.c);

    const [bill] = await this.select("bills", "id = $id", { id: this.bill });
    if (!bill) throw new BuildError(`no bills row for ${this.bill}: run the bills stage first`);
    this.lateUnavailable = bill.late_unavailable ?? null;
    this.names.display = this.display;
    this.names.bill = `${this.display}${bill.short_title ? ` (${bill.short_title})` : ""}`;

    const versions = await this.buildVersions();
    await this.buildSections();
    const window = this.window(bill, versions);
    for (const m of await this.select("members")) this.members.set(m.id, asOf(m, bill.law_on ?? window.end));
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
      sponsor: sponsorId && this.nodes.has(`member:${sponsorId}`) ? nodeId("member", sponsorId) : null,
      law: bill.law ? `P.L. ${lawNumber(bill.law)}` : null,
      lawOn: bill.law_on,
      latestAction: bill.latest_action,
      lateUnavailable: bill.late_unavailable ?? null,
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
      rules: [],
    };
    bundle.claims = Object.fromEntries(this.claims);
    limitGraph(bundle);
    trimEvidence(bundle);
    bundle.rules = [...this.rulesUsed].map(ruleFor).filter((r, i, a) => a.findIndex((x) => x.id === r.id) === i);

    const parsed = BundleSchema.safeParse(bundle);
    if (!parsed.success)
      throw new BuildError(`${this.bill}: bundle fails the schema: ${parsed.error.message.slice(0, 2000)}`);
    const problems = checkBundle(parsed.data);
    if (problems.length)
      throw new BuildError(`${this.bill}: ${problems.length} dangling refs, e.g. ${problems.slice(0, 5).join("; ")}`);
    return { bundle: parsed.data, warnings: this.warnings };
  }

  private async buildVersions(): Promise<Bundle["versions"]> {
    const rows = await this.select("versions", "bill_id = $b", { b: this.bill }, "date NULLS LAST, code");
    const out: Bundle["versions"] = [];
    for (const v of rows) {
      this.versionNames.set(v.code, `"${v.name}"`);
      const fact = await this.cite("versions", v);
      const claim = v.predecessor_rule ? await this.cite("versions", v, "predecessor") : fact;
      if (!claim) continue;
      if (v.predecessor_rule) this.rulesUsed.add(v.predecessor_rule);
      out.push({
        code: v.code,
        name: v.name,
        date: v.date,
        url: v.url,
        sections: v.sections,
        words: v.words,
        predecessor: !!v.predecessor_rule,
        claim,
      });
    }
    return out;
  }

  private async buildSections() {
    const rows = await this.select("sections", "bill_id = $b", { b: this.bill });
    for (const s of rows)
      this.sections.set(s.id, {
        id: s.id,
        num: s.num,
        heading: s.heading,
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
        history: Object.fromEntries(Object.entries(s.history ?? {}).map(([code, h]) => [code, step(h as AnyRow)])),
        dollars: [],
        attention: null,
        score: null,
        claims: [],
      });
    for (const s of rows) {
      const id = await this.cite("sections", s);
      if (id) this.sections.get(s.id)!.claims.push(id);
    }
    for (const c of await this.select("counterparts", "bill_id = $b", { b: this.bill })) {
      const claim = await this.cite("counterparts", c);
      const removed = this.sections.get(c.removed_section_id);
      const added = this.sections.get(c.added_section_id);
      if (!claim || !removed || !added) continue;
      removed.counterpart = { sectionId: added.id, claim };
      added.counterpart = { sectionId: removed.id, claim };
    }
    for (const n of await this.select("cbo_notes", "bill_id = $b AND section_id IS NOT NULL", { b: this.bill })) {
      const claim = await this.cite("cbo_notes", n);
      if (claim) this.sections.get(n.section_id)?.claims.push(claim);
    }
  }

  /** The bill's active span: introduction (or first text) through enactment (or the last dated record). */
  private window(bill: AnyRow, versions: Bundle["versions"]) {
    const dates = [bill.introduced_on, bill.law_on, ...versions.map((v) => v.date)].filter(Boolean) as string[];
    const start = Date.parse(bill.introduced_on ?? dates.sort()[0] ?? isoDay(this.now.getTime()));
    const end = Date.parse(bill.law_on ?? dates.sort().at(-1) ?? isoDay(this.now.getTime()));
    const cycle = (t: number) => {
      const y = new Date(t).getUTCFullYear();
      return y % 2 ? y + 1 : y;
    };
    const cycles: number[] = [];
    for (let c = cycle(start); c <= cycle(end); c += 2) cycles.push(c);
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
      if (!claim) continue;
      const hasMandates = e.mandate_private != null || e.mandate_intergovernmental != null;
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
        mandates: mandatesClaim
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
      if (!est || !known.has(l.estimate_id)) continue;
      const base = {
        estimateId: l.estimate_id,
        baseline: est.baseline,
        measure: l.measure,
        period: l.period,
        ...(l.spending !== undefined && { spending: l.spending }),
      };
      if (l.line_kind === "whole-bill") {
        const claim = await this.cite("cbo_lines", l);
        if (claim) wholeBill.push({ ...base, amountMusd: l.total_musd, split: "exact", claim });
        continue;
      }
      if (l.line_kind !== "section") continue;
      const targets = (l.section_ids as string[]).filter((s) => this.sections.has(s));
      if (!targets.length) continue;
      const fact = await this.cite("cbo_lines", l);
      if (!fact) continue;
      if (targets.length === 1 && l.section_ids.length === 1 && l.split === "exact") {
        this.sections
          .get(targets[0]!)!
          .dollars.push({ ...base, amountMusd: l.total_musd, split: "exact", claim: fact });
        continue;
      }
      for (const s of targets) {
        const claim = await this.cite("cbo_lines", l, s);
        if (claim)
          this.sections
            .get(s)!
            .dollars.push({ ...base, amountMusd: l.total_musd / l.section_ids.length, split: "even_split", claim });
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
      if (claim)
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
    const passage = rolls.filter((r) => PASSAGE.test(r.question)).map((r) => r.id);
    const rollDate = new Map(rolls.map((r) => [r.id, r.date as string]));
    if (passage.length) this.rulesUsed.add("member-votes");
    for (const v of await this.select("member_votes", "list_contains($ids, roll_id)", { ids: passage })) {
      if (!this.members.has(v.bioguide)) continue;
      const on = rollDate.get(v.roll_id)!;
      if (v.vote !== "Not Voting" && on < (this.votedOn.get(v.bioguide) ?? "9")) this.votedOn.set(v.bioguide, on);
      const claim = await this.cite("member_votes", v);
      if (claim)
        this.edge(
          "voted",
          `voted:${v.roll_id}:${v.bioguide}`,
          nodeId("member", v.bioguide),
          nodeId("bill", this.bill),
          [claim],
          { rollId: v.roll_id, vote: v.vote },
        );
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
      if (claim)
        this.edge(
          "sponsored",
          `sponsored:${s.bioguide}`,
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

  /** The committee's node (added on first use), or null when the committees table doesn't know it. */
  private async committee(id: string): Promise<NodeId | null> {
    const key = committeeKey(id);
    const nid = nodeId("committee", key);
    if (this.nodes.has(nid)) return nid;
    const [c] = await this.select("committees", "upper(id) = $k", { k: key });
    if (!c) return null;
    this.labels.committee.set(key, c.name);
    const claim = await this.cite("committees", c);
    this.node({
      id: nid,
      kind: "committee",
      label: c.name,
      claims: claim ? [claim] : [],
      props: { chamber: c.chamber },
    });
    return nid;
  }

  private async buildCommittees() {
    const referred = await this.select("bill_committees", "bill_id = $b", { b: this.bill });
    if (!referred.length) return;
    const keys = [...new Set(referred.map((r) => committeeKey(r.committee_id)))];
    for (const k of keys) await this.committee(k);
    for (const r of referred) {
      const key = committeeKey(r.committee_id);
      if (!this.nodes.has(`committee:${key}`)) {
        this.warnings.push(`bill_committees/${r.id}: no committees row for ${key}`);
        continue;
      }
      const claim = await this.cite("bill_committees", r);
      if (claim)
        this.edge("referred", `referred:${key}`, nodeId("bill", this.bill), nodeId("committee", key), [claim], {
          activity: r.activity,
        });
    }
    const congress = billRef(this.bill).congress;
    const top = keys.filter((k) => k.length === 4);
    for (const m of await this.select("committee_members", "congress = $c AND list_contains($k, upper(committee_id))", {
      c: congress,
      k: top,
    })) {
      if (!this.members.has(m.bioguide)) continue;
      const key = committeeKey(m.committee_id);
      const claim = await this.cite("committee_members", m);
      if (claim)
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

  private async buildAmendments(): Promise<Bundle["amendments"]> {
    const rows = await this.select("amendments", "bill_id = $b", { b: this.bill });
    for (const a of rows) {
      const n = String(a.number);
      this.labels.amendment.set(a.id, /^\d+$/.test(n) ? `${a.chamber === "Senate" ? "S.Amdt." : "H.Amdt."} ${n}` : n);
    }
    const links = await this.select("amendment_sections", "list_contains($ids, amendment_id)", {
      ids: rows.map((a) => a.id),
    });
    const out: Bundle["amendments"] = [];
    for (const a of rows) {
      const claim = await this.cite("amendments", a);
      if (!claim) continue;
      const mine = links.filter((l) => l.amendment_id === a.id && this.sections.has(l.section_id));
      const sponsorKnown = a.sponsor_bioguide && this.members.has(a.sponsor_bioguide);
      if (sponsorKnown) this.memberIds.add(a.sponsor_bioguide);
      const byCommittee = !sponsorKnown && a.sponsor_committee ? await this.committee(a.sponsor_committee) : null;
      for (const l of mine) {
        const link = await this.cite("amendment_sections", l);
        if (link) this.sections.get(l.section_id)!.claims.push(link);
        if (link && sponsorKnown && a.status === "agreed" && (l.effect ?? "inserted") === "inserted")
          this.edge(
            "inserted",
            `inserted:${a.id}:${l.section_id}`,
            nodeId("member", a.sponsor_bioguide),
            nodeId("section", l.section_id),
            [link, claim],
            {
              amendmentId: a.id,
              how: l.how,
            },
          );
      }
      out.push({
        id: a.id,
        number: this.labels.amendment.get(a.id)!,
        chamber: a.chamber,
        sponsor: sponsorKnown ? nodeId("member", a.sponsor_bioguide) : byCommittee,
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
      ? await query<AnyRow>(
          this.db,
          `SELECT r.* FROM lda_bill_refs r JOIN lda_filings f ON f.id = r.filing_id
           WHERE r.bill_id = $b AND r.match IN ('high', 'medium') AND ${live} ORDER BY r.id`,
          { b: this.bill },
        )
      : [];
    for (const r of refs) this.rows.set(`lda_bill_refs/${r.id}`, r);
    const topicRefs = await this.select("lda_topic_refs", "bill_id = $b", { b: this.bill });
    const filingIds = [...new Set([...refs, ...topicRefs].map((r) => r.filing_id))];
    for (const f of await this.select("lda_filings", "list_contains($ids, id)", { ids: filingIds }))
      this.filings.set(f.id, f);

    const clientKeys = [...new Set([...this.filings.values()].map((f) => f.client_key))];
    const clientRows = new Map(
      (await this.select("lda_clients", "list_contains($k, id)", { k: clientKeys })).map((c) => [c.id, c]),
    );
    for (const key of clientKeys) {
      const any = [...this.filings.values()].find((f) => f.client_key === key)!;
      const c = clientRows.get(key);
      this.labels.client.set(key, c?.name ?? any.client_name);
      const claim = c ? await this.cite("lda_clients", c) : null;
      this.node({
        id: nodeId("client", key),
        kind: "client",
        label: c?.name ?? any.client_name,
        claims: claim ? [claim] : [],
        props: {
          names: c?.names ?? [any.client_name],
          ldaClientIds: c?.lda_client_ids ?? [any.lda_client_id],
          description: c?.description ?? any.client_description ?? null,
        },
      });
    }

    const spend = await this.select("lda_spend", "bill_id = $b", { b: this.bill });
    const spendClaims = async (s: AnyRow | undefined) => ({
      total: s?.total_usd != null ? await this.cite("lda_spend", s, "total") : null,
      share: s?.share_usd != null ? await this.cite("lda_spend", s, "share") : null,
    });
    const spendOf = (key: string | null, topic: boolean) =>
      spend.find((s) => s.client_key === key && !!s.topic_only === topic);

    const byClient = groupBy(refs, (r) => this.filings.get(r.filing_id)!.client_key);
    for (const [key, rs] of byClient) {
      const s = spendOf(key, false);
      const { total, share } = await spendClaims(s);
      const claims = [total, ...(await this.cites("lda_bill_refs", rs))].filter((c): c is ClaimId => !!c);
      const sectionNums = new Set(rs.flatMap((r) => r.section_nums as string[]));
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
        if (!target) continue;
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
      if (!key) continue;
      const s = spendOf(key, true);
      const { total, share } = await spendClaims(s);
      const claims = [total, ...(await this.cites("lda_topic_refs", rs))].filter((c): c is ClaimId => !!c);
      this.edge(
        "lobbied",
        `lobbied:topic:${key}`,
        nodeId("client", key),
        nodeId("bill", this.bill),
        claims,
        s ? { ...spendProps(s, true), shareClaim: share } : this.refProps(rs, true),
      );
    }

    const namedFilings = [...new Set(refs.map((r) => r.filing_id))].map((id) => this.filings.get(id)!);
    for (const [pair, fs] of groupBy(namedFilings, (f) => `${f.client_key}|${f.registrant_id}`)) {
      const [key, reg] = pair.split("|") as [string, string];
      this.node({
        id: nodeId("registrant", reg),
        kind: "registrant",
        label: fs[0]!.registrant_name,
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
        l.covered_position &&
        !NO_POSITION.test(l.covered_position.trim()) &&
        (!l.bill_ids?.length || l.bill_ids.includes(this.bill)),
    );
    if (covered.length) this.rulesUsed.add("lobbyist-nodes");
    for (const [lid, ls] of groupBy(covered, (l) => l.lobbyist_id)) {
      const positions = new Map<string, ClaimId>();
      for (const l of ls) {
        const claim = await this.cite("lda_lobbyists", l);
        if (claim && !positions.has(l.covered_position)) positions.set(l.covered_position, claim);
      }
      this.node({
        id: nodeId("lobbyist", lid),
        kind: "lobbyist",
        label: ls[0]!.name,
        claims: [],
        props: { ldaId: lid, coveredPositions: [...positions].map(([quote, claim]) => ({ quote, claim })) },
      });
      for (const [reg, rs] of groupBy(ls, (l) => this.filings.get(l.filing_id)!.registrant_id))
        this.edge(
          "employs",
          `employs:${reg}:${lid}`,
          nodeId("registrant", reg),
          nodeId("lobbyist", lid),
          await this.cites("lda_lobbyists", rs),
          { reports: new Set(rs.map((r) => r.filing_id)).size },
        );
    }

    const whole = spendOf(null, false);
    const phases = { bill: 0, enactmentQuarter: 0, law: 0 };
    const phaseOf = new Map(refs.map((r) => [r.filing_id, r.phase as string]));
    for (const p of phaseOf.values())
      phases[p === "law" ? "law" : p === "enactment-quarter" ? "enactmentQuarter" : "bill"]++;
    return {
      reports: namedFilings.length,
      clients: byClient.size,
      registrants: new Set(namedFilings.map((f) => f.registrant_id)).size,
      lobbyists: new Set(lobbyists.map((l) => l.lobbyist_id)).size,
      byPhase: phases,
      spendTotalUsd: whole?.total_usd ?? null,
      shareEstimateUsd: whole?.share_usd ?? null,
      claims: Object.values(await spendClaims(whole)).filter((c): c is ClaimId => !!c),
    };
  }

  private sectionByNum(num: string): string | undefined {
    const all = [...this.sections.values()].filter((s) => s.num === num);
    return (all.find((s) => s.inFinal) ?? all[0])?.id;
  }

  private refProps(rs: AnyRow[], topicOnly: boolean): EdgeOf<"lobbied">["props"] {
    const filings = [...new Set(rs.map((r) => r.filing_id))]
      .map((id) => this.filings.get(id))
      .filter(Boolean) as AnyRow[];
    const phase = (p: string) => new Set(rs.filter((r) => r.phase === p).map((r) => r.filing_id)).size;
    return {
      reports: filings.length,
      quarters: new Set(filings.map((f) => `${f.year}${f.period}`)).size,
      phases: { bill: phase("bill"), enactmentQuarter: phase("enactment-quarter"), law: phase("law") },
      spendTotalUsd: null,
      shareEstimateUsd: null,
      issueQuote: (rs.find((r) => r.section_nums?.length) ?? rs[0])?.quote ?? null,
      topicOnly,
    };
  }

  /** Companies tied to the bill (the tied-stock rule), and every lobbying client or PAC that resolves to one. */
  private async buildCompanies(): Promise<Map<string, string>> {
    const benefits = await this.select("benefits", "bill_id = $b", { b: this.bill });
    const clientSrcs = [...this.nodes.keys()].filter((k) => k.startsWith("client:"));
    const resolutions = await this.select("resolutions", "list_contains($s, src)", { s: clientSrcs });
    await this.addCompanies([...benefits, ...resolutions].map((r) => r.company_id));
    for (const r of resolutions) {
      if (!this.nodes.has(`company:${r.company_id}`)) continue;
      const claim = await this.cite("resolutions", r);
      if (claim)
        this.edge("resolves_to", `resolves_to:${r.src}`, r.src as NodeId, nodeId("company", r.company_id), [claim], {
          method: r.method,
          reason: r.evidence?.reason ?? null,
        });
    }
    const tied = new Map<string, string>();
    for (const b of benefits) {
      if (!this.nodes.has(`company:${b.company_id}`)) continue;
      const src =
        b.section_id && this.sections.has(b.section_id) ? nodeId("section", b.section_id) : nodeId("bill", this.bill);
      const claim = await this.cite("benefits", b);
      if (!claim) continue;
      this.edge("benefits", `benefits:${src}:${b.company_id}`, src, nodeId("company", b.company_id), [claim], {
        rule: b.basis_rule,
      });
      const company = this.nodes.get(`company:${b.company_id}`) as Extract<Node, { kind: "company" }>;
      for (const t of company.props.tickers) tied.set(t.toUpperCase(), b.company_id);
    }
    if (benefits.length) this.rulesUsed.add("tied-stock");
    return tied;
  }

  private async addCompanies(ids: string[]) {
    const want = [...new Set(ids)].filter((id) => !this.nodes.has(`company:${id}`));
    for (const c of await this.select("companies", "list_contains($ids, id)", { ids: want })) {
      this.labels.company.set(c.id, c.tickers?.length ? `${c.name} (${c.tickers.join(", ")})` : c.name);
      const claim = await this.cite("companies", c);
      this.node({
        id: nodeId("company", c.id),
        kind: "company",
        label: c.name,
        claims: claim ? [claim] : [],
        props: { cik: c.id, tickers: c.tickers ?? [], secUrl: c.source_url },
      });
    }
    for (const id of want) if (!this.nodes.has(`company:${id}`)) this.warnings.push(`company ${id}: no companies row`);
  }

  private async buildTrades(tied: Map<string, string>, w: { tradeFrom: string; tradeTo: string }) {
    if (!tied.size) return;
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
    const fits = trades.filter((t) => !reusedTicker(t.ticker, t.asset));
    if (fits.length < trades.length)
      this.warnings.push(`${trades.length - fits.length} trades left out: the ticker belonged to a different company`);
    const known = fits.filter((t) => t.bioguide && this.members.has(t.bioguide));
    if (known.length < fits.length)
      this.warnings.push(`${fits.length - known.length} trades in tied stocks are from filers not matched to a member`);
    for (const [pair, ts] of groupBy(known, (t) => `${t.bioguide}|${tied.get(t.ticker.toUpperCase())}`)) {
      const [bioguide, company] = pair.split("|") as [string, string];
      const events: EdgeOf<"traded">["props"]["events"] = [];
      for (const t of ts) {
        const claim = await this.cite("trades", t);
        if (claim)
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
      if (events.length)
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

  /** PACs that resolve to a tied company, and what they gave members in the bill's FEC cycles. */
  private async buildMoney(tied: Map<string, string>, w: { cycles: number[]; end: string }) {
    const companies = [...new Set(tied.values())];
    if (!companies.length) return;
    const res = await this.select("resolutions", "src LIKE 'pac:%' AND list_contains($c, company_id)", {
      c: companies,
    });
    const pacIds = [...new Set(res.map((r) => r.src.slice(4)))];
    const pacs = await this.select("pacs", "list_contains($ids, id)", { ids: pacIds });
    for (const p of pacs) {
      this.labels.pac.set(p.id, p.name);
      const claim = await this.cite("pacs", p);
      this.node({
        id: nodeId("pac", p.id),
        kind: "pac",
        label: p.name,
        claims: claim ? [claim] : [],
        props: { fecId: p.id, connectedOrg: p.connected_org },
      });
    }
    for (const r of res) {
      if (!this.nodes.has(r.src)) continue;
      const claim = await this.cite("resolutions", r);
      if (claim)
        this.edge("resolves_to", `resolves_to:${r.src}`, r.src as NodeId, nodeId("company", r.company_id), [claim], {
          method: r.method,
          reason: r.evidence?.reason ?? null,
        });
    }
    if (!pacs.length) return;
    this.rulesUsed.add("affected-donors");
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
      gifts.filter((g) => this.members.has(g.bioguide)),
      (g) => `${g.pac_id}|${g.bioguide}`,
    )) {
      const [pac, bioguide] = pair.split("|") as [string, string];
      const periods = w.cycles.map((c) => `&two_year_transaction_period=${c}`).join("");
      const recipients = [...new Set(gs.map((g) => g.recipient_committee_id).filter(Boolean))];
      const to = recipients.length === 1 ? `&recipient_committee_id=${recipients[0]}` : "";
      const cutoff = this.votedOn.get(bioguide) ?? w.end;
      const before = gs.filter((g) => g.date <= cutoff);
      const sum = (list: AnyRow[]) => list.reduce((a, g) => a + g.amount_usd, 0);
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
          first: gs[0]!.date,
          last: gs.at(-1)!.date,
          allTxnsUrl: `https://www.fec.gov/data/disbursements/?data_type=processed&committee_id=${pac}${to}${periods}`,
        },
      );
    }
  }

  private async buildAttention(): Promise<Bundle["attention"]> {
    const rows = await this.select("attention", "bill_id = $b", { b: this.bill });
    const articles = this.tables.has("articles")
      ? await query<AnyRow>(
          this.db,
          `SELECT a.*, o.name AS outlet_name, o."group" AS outlet_group, o.list_version
           FROM articles a LEFT JOIN outlets o ON o.id = a.outlet_id WHERE a.bill_id = $b ORDER BY a.id`,
          { b: this.bill },
        )
      : [];
    const byId = new Map(articles.map((a) => [a.id, a]));
    const shape = async (r: AnyRow): Promise<Section["attention"]> => {
      const claim = await this.cite("attention", r);
      if (!claim) return null;
      const examples = [];
      for (const id of r.example_article_ids as string[]) {
        const a = byId.get(id);
        if (!a) continue;
        const { outlet_name, outlet_group, list_version, ...row } = a;
        const c = await this.cite("articles", { ...row, outlet_name });
        if (c)
          examples.push({
            url: a.url,
            outlet: outlet_name ?? new URL(a.url).hostname,
            group: outlet_group ?? "unlisted",
            title: a.title,
            date: a.published_on,
            claim: c,
          });
      }
      const groups = Object.fromEntries(
        Object.entries(r.hits_by_group ?? {}).filter(([g]) => OutletGroup.safeParse(g).success),
      ) as Record<string, number>;
      return { hits: r.hits, pct: r.pct, hitsByGroup: groups, tradeLegalHits: r.trade_legal_hits, examples, claim };
    };
    let general: Section["attention"] = null;
    for (const r of rows) {
      if (r.section_id == null) general = await shape(r);
      else if (this.sections.has(r.section_id)) this.sections.get(r.section_id)!.attention = await shape(r);
    }
    const dates = articles
      .map((a) => a.published_on)
      .filter(Boolean)
      .sort();
    return {
      via: [...new Set(articles.map((a) => a.via))].sort() as Bundle["attention"]["via"],
      outletListVersion: articles.find((a) => a.list_version)?.list_version ?? null,
      window: dates.length ? [dates[0], dates.at(-1)] : null,
      articles: articles.length,
      general,
    };
  }

  private async buildScores() {
    for (const s of await this.select("section_scores", "bill_id = $b", { b: this.bill })) {
      const section = this.sections.get(s.section_id);
      const claim = section && (await this.cite("section_scores", s));
      if (!section || !claim) continue;
      section.score = {
        label: s.label,
        buried: s.buried,
        components: {
          dollarsMusd: s.dollars_musd,
          dollarsSplit: s.dollars_split,
          attentionPct: s.attention_pct,
          late: s.late,
          offTopic: s.off_topic,
          lobbyingReports: s.lobbying_reports,
        },
        claim,
      };
    }
  }

  /** Member nodes for everyone an edge names; flags members whose paper filings in the trade window aren't read. */
  private async buildMembers(w: { tradeFrom: string; tradeTo: string }) {
    const unread = await this.select(
      "ptr_documents",
      "read_status <> 'read' AND bioguide IS NOT NULL AND (filed_on IS NULL OR filed_on BETWEEN $from AND $to)",
      { from: w.tradeFrom, to: w.tradeTo },
    );
    const unreadIds = new Set(unread.map((d) => d.bioguide));
    for (const id of this.memberIds) {
      const m = this.members.get(id)!;
      const claim = await this.cite("members", m, m.term?.start ?? null);
      this.node({
        id: nodeId("member", id),
        kind: "member",
        label: memberLabel(this.names.member(id)!),
        claims: claim ? [claim] : [],
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
    return {
      members: [...unreadIds].map((id) => this.members.get(id)).filter(Boolean) as AnyRow[],
      loaded: this.tables.has("ptr_documents") && (await this.count("ptr_documents")) > 0,
    };
  }

  private async count(table: string) {
    return (await query<{ n: number }>(this.db, `SELECT count(*)::INTEGER AS n FROM ${table}`))[0]!.n;
  }

  private async buildGaps(x: {
    dollars: Bundle["dollars"];
    attention: Bundle["attention"];
    lobbying: Bundle["lobbying"];
    unread: { members: AnyRow[]; loaded: boolean };
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

    if (this.lateUnavailable)
      gap("late-unavailable", "late_unavailable", `Late flag unavailable: ${this.lateUnavailable}`);
    if (!x.unread.loaded)
      gap("trades-not-loaded", "other", "Member trade filings aren't loaded yet, so no trades show here.");
    else if (x.unread.members.length) {
      const by = (p: string) => x.unread.members.filter((m) => m.party === p).length;
      gap(
        "paper-ptrs",
        "paper_filings_unread",
        `Paper filings not yet read: ${count(x.unread.members.length, "member")} (${by("R")} R, ${by("D")} D, ${by("I")} I) filed trade reports in this bill's window that haven't been read, so their trades may be missing here.`,
        x.unread.members.map((m) => nodeId("member", m.id)).filter((id) => this.nodes.has(id)),
      );
    }
    const { estimates } = x.dollars;
    if (!estimates.length)
      gap(
        "no-cbo",
        "no_section_dollars",
        "No CBO cost estimate is loaded for this bill, so no dollar figures show here.",
      );
    else if (!estimates.some((e) => e.perSection) && !x.sections.some((s) => s.dollars.length))
      gap(
        "no-section-dollars",
        "no_section_dollars",
        "CBO published whole-bill numbers only for this bill, so no section has its own dollar figure.",
        [],
        estimates[0]!.claim,
      );
    if (!x.attention.articles)
      gap("no-attention", "attention_partial", "News attention isn't measured for this bill yet.");
    else if (!x.attention.via.includes("mediacloud"))
      gap(
        "attention-gnews",
        "attention_partial",
        "News attention here comes from Google News only, not from the counted Media Cloud outlet list.",
      );
    if (!this.tables.has("lda_bill_refs") || !(await this.count("lda_bill_refs")))
      gap("no-lobbying", "other", "Lobbying filings aren't loaded yet, so no lobbying shows here.");
    else if (x.lobbying.clients) {
      const clients = [...this.nodes.keys()].filter((k) => k.startsWith("client:"));
      const resolved = clients.filter((c) => this.edges.has(`resolves_to:${c}`)).length;
      gap(
        "entity-recall",
        "entity_recall",
        `${resolved} of ${count(clients.length, "lobbying client")} resolve to a public company; the rest (trade groups, nonprofits, private firms) have no stock to trade.`,
      );
    }
    const removed = this.warnings.filter((w) => w.includes("not matched to a member"));
    if (removed.length) gap("unmatched-filers", "entity_recall", removed.join("; "));
    return gaps;
  }
}

const PARTY_LETTER: Record<string, "R" | "D" | "I"> = { Republican: "R", Democrat: "D", Democratic: "D" };

/**
 * A member as they were on `day`: the party, state, district and chamber of the term that covers it (or the last
 * term before it), so a bill shows who a member was then. Rows without terms keep their own fields.
 */
export function asOf(m: AnyRow, day: string): AnyRow {
  const terms = (m.terms ?? []) as AnyRow[];
  const term = terms.find((t) => t.start <= day && day <= t.end) ?? terms.filter((t) => t.start <= day).at(-1);
  if (!term) return m;
  const party = PARTY_LETTER[term.party] ?? "I";
  return { ...m, party, state: term.state, district: term.district ?? null, chamber: term.chamber, term };
}

function step(h: AnyRow): Section["history"][string] {
  return {
    path: h.path ?? "",
    heading: h.heading ?? "",
    words: h.words ?? 0,
    match: h.match ?? null,
    similarity: h.similarity ?? null,
    wordsAdded: h.wordsAdded ?? h.words_added ?? null,
    wordsRemoved: h.wordsRemoved ?? h.words_removed ?? null,
    largestInserts: h.largestInserts ?? h.largest_inserts ?? [],
  };
}

function spendProps(s: AnyRow, topicOnly: boolean): EdgeOf<"lobbied">["props"] {
  return {
    reports: s.reports,
    quarters: s.quarters,
    phases: { bill: s.reports_bill, enactmentQuarter: s.reports_enactment_quarter, law: s.reports_law },
    spendTotalUsd: s.total_usd,
    shareEstimateUsd: s.share_usd,
    issueQuote: s.issue_quote,
    topicOnly,
  };
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    (m.get(k) ?? m.set(k, []).get(k)!).push(x);
  }
  return m;
}

/** Placeholder while a claim's restsOn resolve, so a cycle stops instead of recursing. */
const PENDING = { kind: "fact" } as Claim;
