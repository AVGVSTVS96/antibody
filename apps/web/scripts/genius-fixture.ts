/**
 * Builds a full contract Bundle for S.1582 (GENIUS Act) from the Phase 0 spike outputs, so the site has a
 * real, rich bill to render before @antibody/store publishes bundles. Every record comes from the spikes;
 * nothing is invented. Run from the repo root: `bun apps/web/scripts/genius-fixture.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Bundle, type Claim, checkBundle, type Edge, type Node } from "@antibody/core";
import { DATA, ROOT } from "@antibody/core/node";
import { DuckDBInstance } from "@duckdb/node-api";

const SPIKES = join(ROOT, "spikes");
const read = (p: string) => JSON.parse(readFileSync(join(SPIKES, p), "utf8"));

const G = read("report/out/genius.json");
const L = read("bills/out/genius-s1582.sections.json");

const BILL = "119-s-1582";
const claims: Record<string, Claim> = {};
const fact = (id: string, text: string, sourceUrl: string, more: Partial<Claim> = {}) => {
  claims[id] = {
    id,
    text,
    kind: "fact",
    sourceUrl,
    sourceLocator: null,
    archiveUrl: null,
    quote: null,
    confidence: 1,
    restsOn: [],
    rule: null,
    ...more,
  };
  return id;
};
const infer = (id: string, text: string, sourceUrl: string, rule: string, restsOn: string[], confidence = 0.8) => {
  claims[id] = {
    id,
    text,
    kind: "inference",
    sourceUrl,
    sourceLocator: null,
    archiveUrl: null,
    quote: null,
    confidence,
    restsOn,
    rule,
  };
  return id;
};
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const versionByCode = new Map<string, { code: string; name: string; date: string; url: string }>(
  G.versions.map((v: { code: string }) => [v.code, v]),
);
const enr = versionByCode.get("enr")!;

const billClaim = fact(
  `bills/${BILL}`,
  `S.1582, the GENIUS Act, became Public Law 119-27 on ${G.bill.signed}.`,
  G.bill.url,
);
const sponsorClaim = fact(
  `sponsorships/${BILL}:H000601`,
  "Sen. Bill Hagerty (R-TN) is the sponsor of S.1582.",
  G.bill.url,
);

const versions = G.versions.map(
  (v: { code: string; name: string; date: string; url: string; sections: number; words: number }) => {
    const id = `versions/${BILL}@${v.code}`;
    const isPred = v.code === "s394-is";
    return {
      code: v.code,
      name: v.name,
      date: v.date,
      url: v.url,
      sections: v.sections,
      words: v.words,
      predecessor: isPred,
      claim: isPred
        ? infer(
            id,
            "S.394 (introduced 2025-02-04) is treated as the earlier stage of S.1582: same short title, same sponsor, and its sections carry into the committee text.",
            v.url,
            "predecessor-bill: an earlier bill with the same short title and sponsor whose sections match the bill's first text",
            [`versions/${BILL}@pcs`, billClaim],
            0.9,
          )
        : fact(
            id,
            `${v.name}, dated ${v.date}: ${v.sections} sections, ${v.words.toLocaleString("en-US")} words.`,
            v.url,
          ),
    };
  },
);

type Lineage = {
  id: string;
  heading: string;
  first_version: string;
  changed_in: string[];
  removed_in: string | null;
  revived_in: string[];
  split_from: string | null;
  merged_into: string | null;
  in_final: boolean;
  preview: string;
  versions: Record<
    string,
    {
      path: string;
      heading: string;
      words: number;
      match?: string;
      similarity?: number;
      diff_from_prev?: { words_added: number; words_removed: number; largest_inserts: string[] };
    }
  >;
};
const lineage = new Map<string, Lineage>(
  (L.sections as Lineage[]).map((s) => [s.versions.enr?.path.split(":")[1] ?? s.id, s]),
);

const HEADLINE = 0.85;
const QUIET = 0.25;
const ATTN_RULE =
  "attention v0: Google News RSS headlines, articles and paragraphs matched to sections by embedding; percentile within this bill";

const sections = G.sections.map(
  (s: {
    num: number;
    heading: string;
    words: number;
    late: boolean;
    kind: "headline" | "buried" | "normal";
    attention_pct: number | null;
    attention_hits: number | null;
    attention_example: { url: string; source: string; text: string } | null;
  }) => {
    const lin = lineage.get(String(s.num))!;
    const first = versionByCode.get(lin.first_version)!;
    const secClaim = fact(
      `sections/${lin.id}`,
      `§${s.num} "${s.heading}" first appears in ${first.name} (${first.date}).`,
      first.url,
      { sourceLocator: lin.versions[lin.first_version]!.path.replace("sec:", "section ") },
    );
    const textClaim = fact(
      `sections/${lin.id}#final`,
      `§${s.num} "${s.heading}" is in the enrolled text: ${s.words.toLocaleString("en-US")} words.`,
      enr.url,
      { sourceLocator: `section ${s.num}` },
    );
    let attention = null;
    if (s.attention_pct != null) {
      const examples = [];
      if (s.attention_example) {
        const ex = s.attention_example;
        const exClaim = fact(
          `articles/gnews-${slug(ex.text).slice(0, 48)}`,
          `${ex.source} published "${ex.text}".`,
          ex.url,
        );
        examples.push({
          url: ex.url,
          outlet: ex.source,
          group: "unlisted",
          title: ex.text,
          date: null,
          claim: exClaim,
        });
      }
      const aClaim = infer(
        `attention/${lin.id}`,
        `§${s.num} matched ${s.attention_hits} news units, percentile ${Math.round(s.attention_pct * 100)} of 17 scored sections.`,
        "https://github.com/AVGVSTVS96/antibody/blob/main/spikes/attention/RESULTS.md",
        ATTN_RULE,
        [secClaim, ...examples.map((e) => e.claim)],
        0.5,
      );
      attention = {
        hits: s.attention_hits ?? 0,
        pct: s.attention_pct,
        hitsByGroup: {},
        tradeLegalHits: 0,
        examples,
        claim: aClaim,
      };
    }
    const label = s.kind;
    const score = attention
      ? {
          label,
          buried: label === "buried" ? 1 - attention.pct! : null,
          components: {
            dollarsMusd: null,
            dollarsSplit: null,
            attentionPct: attention.pct,
            late: s.late,
            offTopic: null,
            lobbyingReports: 0,
          },
          claim: infer(
            `section_scores/${lin.id}`,
            label === "buried"
              ? `§${s.num} is a buried candidate: it first appears after the first chamber text and sits in the bottom ${QUIET * 100}% of news attention.`
              : label === "headline"
                ? `§${s.num} is a headline section: top ${Math.round((1 - HEADLINE) * 100)}% of news attention on this bill.`
                : `§${s.num} is neither headline nor buried under the published thresholds.`,
            enr.url,
            `buried v0: late (from the version lineage) and attention percentile <= ${QUIET}; headline: attention percentile >= ${HEADLINE}`,
            [secClaim, attention.claim],
            0.5,
          ),
        }
      : null;
    const history = Object.fromEntries(
      Object.entries(lin.versions).map(([code, v]) => [
        code,
        {
          path: v.path,
          heading: v.heading,
          words: v.words,
          match: v.match ?? null,
          similarity: v.similarity ?? null,
          wordsAdded: v.diff_from_prev?.words_added ?? null,
          wordsRemoved: v.diff_from_prev?.words_removed ?? null,
          largestInserts: v.diff_from_prev?.largest_inserts ?? [],
        },
      ]),
    );
    return {
      id: lin.id,
      num: String(s.num),
      heading: s.heading,
      path: `sec:${s.num}`,
      firstVersion: lin.first_version,
      inFinal: lin.in_final,
      late: s.late,
      changedIn: lin.changed_in,
      removedIn: lin.removed_in,
      revivedIn: lin.revived_in,
      splitFrom: lin.split_from,
      splitInto: [],
      mergedInto: lin.merged_into,
      counterpart: null,
      words: s.words,
      textUrl: enr.url,
      preview: lin.preview,
      history,
      dollars: [],
      attention,
      score,
      claims: [secClaim, textClaim],
    };
  },
);

const ROLL = /vote_119_1_0*(\d+)\.xml|roll(\d+)\.xml/;
const votes = G.bill.votes
  .filter((v: { url: string }) => ROLL.test(v.url))
  .map((v: { date: string; label: string; url: string }) => {
    const m = v.url.match(ROLL)!;
    const senate = !!m[1];
    const number = Number(m[1] ?? m[2]);
    const [yeas, nays] = v.label
      .match(/(\d+)-(\d+)/)!
      .slice(1)
      .map(Number) as [number, number];
    const id = `${senate ? "senate" : "house"}-119-1-${number}`;
    const question = v.label.includes("cloture")
      ? "On the Cloture Motion (Motion to Proceed to S. 1582)"
      : senate
        ? "On Passage of the Bill S. 1582"
        : "On Passage of S. 1582";
    const result = v.label.includes("fails")
      ? "Cloture Motion Rejected"
      : v.label.includes("cloture")
        ? "Cloture Motion Agreed to"
        : senate
          ? "Bill Passed"
          : "Passed";
    return {
      id,
      chamber: senate ? "Senate" : "House",
      number,
      date: v.date,
      question,
      result,
      yeas,
      nays,
      url: v.url,
      claim: fact(
        `roll_calls/${id}`,
        `${senate ? "Senate" : "House"} roll call ${number} (${v.date}): ${question}, ${yeas}-${nays}.`,
        v.url,
      ),
    };
  });
const finalRoll = new Map<string, string>(votes.map((v: { url: string; id: string }) => [v.url, v.id]));

const sa = G.amendments_agreed[0];
const s19 = sections.find((s: { num: string }) => s.num === "19")!;
const lateIds = sections.filter((s: { late: boolean }) => s.late).map((s: { id: string }) => s.id);
const amendmentClaim = fact(
  "amendments/119-samdt-2307",
  `SA 2307 (Sen. Hagerty, "In the nature of a substitute") was agreed to 67-30 on ${sa.agreed_on}.`,
  sa.source,
  { quote: sa.latest_action },
);
const amendments = [
  {
    id: "119-samdt-2307",
    number: "SA 2307",
    chamber: "Senate",
    sponsor: "member:H000601",
    purpose: sa.purpose,
    status: "agreed",
    latestAction: sa.latest_action,
    latestActionOn: sa.agreed_on,
    rollId: "senate-119-1-311",
    versionStep: sa.version_step,
    url: sa.source,
    sections: lateIds,
    claim: amendmentClaim,
  },
];
claims["roll_calls/senate-119-1-311"] = {
  ...claims[amendmentClaim]!,
  id: "roll_calls/senate-119-1-311",
  text: "Senate roll call 311: SA 2307 agreed to, 67-30.",
  sourceUrl: "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1191/vote_119_1_00311.xml",
  quote: null,
};

const cbo = G.cbo;
const [xlsx, locator] = [cbo.cite.split(" ")[0], cbo.cite.match(/\((.*)\)/)?.[1] ?? null];
const estClaim = fact(
  "cbo_estimates/s1582-es",
  "CBO scored S.1582 as passed by the Senate on June 17, 2025, against its current-law baseline.",
  cbo.estimate_url,
);
const mandClaim = fact(
  "cbo_estimates/s1582-es#mandates",
  "CBO: the bill has a private-sector mandate over the UMRA threshold and an intergovernmental mandate under it.",
  cbo.mandates.cite,
  { sourceLocator: "page 1, summary table" },
);
const line = (measure: "outlays" | "revenues", amount: number) =>
  fact(
    `cbo_lines/s1582-es:${measure}`,
    `CBO: ${measure} change of ${amount > 0 ? "+" : ""}$${amount}M over ${cbo.period} (current-law baseline).`,
    xlsx,
    { sourceLocator: locator },
  );
const outlays = line("outlays", cbo.outlays);
const revenues = line("revenues", cbo.revenues);
const deficit = fact(
  "cbo_lines/s1582-es:deficit",
  `CBO: the bill adds $${cbo.deficit}M to the deficit over ${cbo.period} (outlays +$${cbo.outlays}M, revenues $${cbo.revenues}M; current-law baseline).`,
  xlsx,
  { sourceLocator: locator, restsOn: [outlays, revenues] },
);
const dollarLine = (measure: "outlays" | "revenues" | "deficit", amountMusd: number, claim: string) => ({
  estimateId: "s1582-es",
  baseline: "current-law" as const,
  measure,
  period: cbo.period,
  amountMusd,
  split: "exact" as const,
  claim,
});

const nodes: Node[] = [];
const edges: Edge[] = [];
const edgeIds = new Set<string>();
const addEdge = (e: Omit<Edge, "id"> & { id?: string }) => {
  const id = e.id ?? `${e.kind}:${e.src}->${e.dst}`;
  if (edgeIds.has(id)) return;
  edgeIds.add(id);
  edges.push({ ...e, id } as Edge);
};
const bill = `bill:${BILL}` as const;

const COMMITTEES: Record<string, { code: string; chamber: "House" | "Senate" }> = {
  "House Financial Services": { code: "HSBA", chamber: "House" },
  "Senate Banking, Housing, and Urban Affairs": { code: "SSBK", chamber: "Senate" },
};
const COMMITTEE_URL = "https://theunitedstates.io/congress-legislators/committee-membership-current.yaml";
for (const [name, c] of Object.entries(COMMITTEES)) {
  nodes.push({
    id: `committee:${c.code}`,
    kind: "committee",
    label: name,
    claims: [
      fact(
        `committees/${c.code}`,
        `${name} (${c.code}).`,
        "https://theunitedstates.io/congress-legislators/committees-current.yaml",
      ),
    ],
    props: { chamber: c.chamber },
  });
}
addEdge({
  kind: "referred",
  src: bill,
  dst: "committee:SSBK",
  basis: "fact",
  claims: [fact(`bill_committees/${BILL}:SSBK`, "S.1582 went to the Senate Banking Committee.", G.bill.billstatus)],
  props: { activity: null },
});

type Company = {
  id: string;
  label: string;
  ticker: string | null;
  sec_url: string | null;
  public: boolean;
  resolution: { method: string; confidence: number; reason: string | null; client: string } | null;
  clients: string[];
  filings: number;
  lobby_url: string;
  issue_text: string | null;
  reports: number | null;
  firms: number | null;
  quarters: number | null;
  spend_total: number | null;
  share_est: number | null;
  phases: string[] | null;
};
const titleCase = (s: string) =>
  s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s(&-])(\w)/g, (_m, a, b) => a + b.toUpperCase()) : s;

const lobbiedRule = (topicOnly: boolean) =>
  topicOnly
    ? "topic-only lobbying: the filing describes the bill's subject without naming it"
    : "named-the-bill: the LD-2 issue text names S.1582, S.394, S.919 or the GENIUS Act";

for (const c of G.companies as Company[]) {
  const clientName = c.resolution?.client ?? c.clients[0] ?? c.label;
  const key = slug(clientName);
  const clientId = `client:${key}` as const;
  const clientClaim = fact(
    `lda_clients/${key}`,
    `${titleCase(clientName)} filed ${c.filings} LD-2 report${c.filings === 1 ? "" : "s"} naming the bill.`,
    c.lobby_url,
    { quote: c.issue_text },
  );
  nodes.push({
    id: clientId,
    kind: "client",
    label: titleCase(c.public ? clientName : c.label),
    claims: [clientClaim],
    props: { names: c.clients.length ? c.clients : [clientName], ldaClientIds: [], description: null },
  });
  const phases = { bill: 0, enactmentQuarter: 0, law: 0 };
  for (const p of c.phases ?? []) {
    if (p === "bill") phases.bill = 1;
    if (p === "enactment-quarter") phases.enactmentQuarter = 1;
    if (p === "law") phases.law = 1;
  }
  const topicOnly = !c.issue_text || !/1582|394|919|GENIUS/i.test(c.issue_text);
  const refClaim = topicOnly
    ? infer(
        `lda_bill_refs/${key}`,
        `${titleCase(clientName)} lobbied on the bill's subject.`,
        c.lobby_url,
        lobbiedRule(true),
        [clientClaim],
        0.6,
      )
    : fact(`lda_bill_refs/${key}`, `${titleCase(clientName)}'s LD-2 names the bill.`, c.lobby_url, {
        quote: c.issue_text,
      });
  const shareClaim =
    c.share_est != null
      ? infer(
          `lda_bill_refs/${key}#share`,
          `Estimated ${usd(c.share_est)} of ${usd(c.spend_total ?? 0)} total spend on the quarters naming the bill went to it.`,
          c.lobby_url,
          "bill-share: each report's total split evenly over the issues it lists",
          [refClaim],
          0.4,
        )
      : null;
  addEdge({
    kind: "lobbied",
    src: clientId,
    dst: bill,
    basis: topicOnly ? "inference" : "fact",
    claims: shareClaim ? [refClaim, shareClaim] : [refClaim],
    props: {
      reports: c.reports ?? c.filings,
      quarters: c.quarters ?? 0,
      phases,
      spendTotalUsd: c.spend_total,
      shareEstimateUsd: c.share_est,
      issueQuote: c.issue_text,
      topicOnly,
    },
  });
  if (c.public && c.sec_url && c.resolution) {
    const cik = c.id.split(":")[1]!;
    const companyId = `company:${cik}` as const;
    const coClaim = fact(
      `companies/${cik}`,
      `${titleCase(c.label)} is SEC registrant CIK ${cik}${c.ticker ? `, ticker ${c.ticker}` : ""}.`,
      c.sec_url,
    );
    nodes.push({
      id: companyId,
      kind: "company",
      label: c.label,
      claims: [coClaim],
      props: { cik, tickers: c.ticker ? [c.ticker] : [], secUrl: c.sec_url },
    });
    const resClaim = infer(
      `resolutions/${key}`,
      c.resolution.method === "name_exact"
        ? `LDA client "${titleCase(clientName)}" is the same company as SEC registrant ${titleCase(c.label)} (exact name match).`
        : `LDA client "${titleCase(clientName)}" resolves to ${titleCase(c.label)}: ${c.resolution.reason ?? "same company"}.`,
      c.sec_url,
      c.resolution.method === "name_exact"
        ? "name-exact: normalized client name equals the SEC registrant name"
        : "llm-review: a model judged the client to be the company or its subsidiary, keeping its reason",
      [clientClaim, coClaim],
      c.resolution.confidence,
    );
    addEdge({
      kind: "resolves_to",
      src: clientId,
      dst: companyId,
      basis: "inference",
      claims: [resClaim],
      props: { method: c.resolution.method, reason: c.resolution.reason },
    });
    addEdge({
      kind: "benefits",
      src: bill,
      dst: companyId,
      basis: "inference",
      claims: [
        infer(
          `benefits/${cik}`,
          `${titleCase(c.label)} is tied to the bill: it lobbied on it.`,
          c.lobby_url,
          "tied-stock: the company lobbied on the bill (LDA) or is named in its text",
          [refClaim, resClaim],
          0.7,
        ),
      ],
      props: { rule: "lobbied" },
    });
  }
}

const OWNER: Record<string, "self" | "spouse" | "joint" | "dependent"> = {
  self: "self",
  Self: "self",
  SP: "spouse",
  Spouse: "spouse",
  JT: "joint",
  Joint: "joint",
  DC: "dependent",
};
const TYPE = (t: string) =>
  /partial/i.test(t) ? "sale_partial" : /sale/i.test(t) ? "sale" : /exchange/i.test(t) ? "exchange" : "purchase";

type Legislator = { id: { bioguide: string }; terms: { type: string; state: string; district?: number }[] };
const legislators = new Map<string, Legislator["terms"][number]>();
for (const f of ["legislators-historical.json", "legislators-current.json"])
  for (const l of JSON.parse(readFileSync(join(DATA, "members", f), "utf8")) as Legislator[])
    legislators.set(l.id.bioguide, l.terms.at(-1)!);

const paperNames = new Set((G.trades.paper_unread as { name: string }[]).map((p) => p.name));

type Member = {
  id: string;
  bioguide: string;
  name: string;
  party: "R" | "D" | "I";
  chamber: "House" | "Senate";
  state: string | null;
  vote: string | null;
  vote_url: string | null;
  role: string | null;
  committees: { committee: string; role: string }[];
  trades: {
    company: string;
    ticker: string;
    type: string;
    date: string;
    amount: string;
    owner: string;
    source: string;
  }[];
  funding: {
    company: string;
    amount: number;
    contributions: number;
    pac: string;
    url: string;
    pac_url: string;
    all_txns: string;
  }[];
};

const db = await (
  await DuckDBInstance.create(join(DATA, "entities/genius.duckdb"), { access_mode: "READ_ONLY" })
).connect();
const spanRows = (
  await db.runAndReadAll("SELECT CMTE_ID, member, min(dt)::VARCHAR, max(dt)::VARCHAR FROM fec_pas2 GROUP BY 1, 2")
).getRows();
const spans = new Map(spanRows.map((r) => [`${r[0]}|${r[1]}`, [String(r[2]), String(r[3])] as const]));

const companyNodes = new Set(nodes.filter((n) => n.kind === "company").map((n) => n.id));
const clientOfCompany = new Map(edges.filter((e) => e.kind === "resolves_to").map((e) => [e.dst, e.src] as const));
const pacs = new Map<string, string>();

for (const m of G.members as Member[]) {
  const id = `member:${m.bioguide}` as const;
  const term = legislators.get(m.bioguide);
  m.state ??= term?.state ?? "";
  const district = m.chamber === "House" ? (term?.district ?? null) : null;
  const title = m.chamber === "Senate" ? "Sen." : "Rep.";
  const memberClaim = fact(
    `members/${m.bioguide}`,
    `${title} ${m.name} (${m.party}-${m.state}), ${m.chamber}.`,
    `https://bioguide.congress.gov/search/bio/${m.bioguide}`,
  );
  nodes.push({
    id,
    kind: "member",
    label: `${title} ${m.name} (${m.party}-${m.state}${district ? `-${district}` : ""})`,
    claims: [memberClaim],
    props: {
      bioguide: m.bioguide,
      party: m.party,
      state: m.state,
      district,
      chamber: m.chamber,
      paperFilingsUnread: paperNames.has(m.name),
    },
  });
  if (m.role === "sponsored")
    addEdge({
      kind: "sponsored",
      src: id,
      dst: bill,
      basis: "fact",
      claims: [sponsorClaim],
      props: { role: "sponsor", date: "2025-05-01", withdrawnOn: null },
    });
  for (const c of m.committees) {
    const cm = COMMITTEES[c.committee];
    if (!cm) continue;
    addEdge({
      kind: "member_of",
      src: id,
      dst: `committee:${cm.code}`,
      basis: "fact",
      claims: [
        fact(
          `committee_members/${cm.code}:${m.bioguide}`,
          `${title} ${m.name} sits on ${c.committee} (${c.role}).`,
          COMMITTEE_URL,
        ),
      ],
      props: { role: c.role },
    });
  }
  if (m.vote && m.vote_url && finalRoll.has(m.vote_url)) {
    const rollId = finalRoll.get(m.vote_url)!;
    addEdge({
      kind: "voted",
      src: id,
      dst: bill,
      basis: "fact",
      claims: [
        fact(
          `member_votes/${rollId}:${m.bioguide}`,
          `${title} ${m.name} voted ${m.vote} on final passage.`,
          m.vote_url,
        ),
      ],
      props: { rollId, vote: m.vote as "Yea" | "Nay" },
    });
  }
  const byCompany = new Map<string, Member["trades"]>();
  for (const t of m.trades) byCompany.set(t.company, [...(byCompany.get(t.company) ?? []), t]);
  for (const [company, ts] of byCompany) {
    if (!companyNodes.has(company as `company:${string}`)) continue;
    const events = ts.map((t, i) => {
      const doc = t.source.match(/(\d{8})\.pdf|ptr\/([0-9a-f-]+)\/?$/);
      const docId = doc?.[1] ?? doc?.[2] ?? slug(t.source);
      const owner = OWNER[t.owner] ?? "self";
      const whose = owner === "self" ? "" : owner === "joint" ? " (jointly held)" : ` (${owner}'s)`;
      return {
        date: t.date,
        type: TYPE(t.type) as "purchase" | "sale" | "sale_partial" | "exchange",
        amount: t.amount,
        owner,
        ticker: t.ticker,
        asset: t.ticker,
        readBy: t.source.endsWith(".pdf") ? ("text" as const) : ("html" as const),
        claim: fact(
          `trades/${docId}#${m.bioguide}-${t.ticker}-${t.date}-${i}`,
          `${title} ${m.name} reported a ${t.type.toLowerCase()} of ${t.ticker}${whose}, ${t.amount}, on ${t.date}.`,
          t.source,
        ),
      };
    });
    addEdge({
      kind: "traded",
      src: id,
      dst: company as `company:${string}`,
      basis: "fact",
      claims: events.map((e) => e.claim),
      props: { events },
    });
  }
  for (const f of m.funding) {
    const fecId = f.pac_url.match(/committee\/(C\d+)/)![1]!;
    const pacId = `pac:${fecId}` as const;
    if (!pacs.has(fecId)) {
      pacs.set(fecId, f.company);
      const pacClaim = fact(`pacs/${fecId}`, `${titleCase(f.pac)} is FEC committee ${fecId}.`, f.pac_url);
      nodes.push({
        id: pacId,
        kind: "pac",
        label: titleCase(f.pac),
        claims: [pacClaim],
        props: { fecId, connectedOrg: null },
      });
      const target =
        f.company.startsWith("company:") && companyNodes.has(f.company as `company:${string}`)
          ? f.company
          : (clientOfCompany.get(f.company as `company:${string}`) ?? f.company);
      const targetNode = nodes.find((n) => n.id === target);
      if (targetNode && (targetNode.kind === "company" || targetNode.kind === "client")) {
        addEdge({
          kind: "resolves_to",
          src: pacId,
          dst: target as `company:${string}`,
          basis: "inference",
          claims: [
            infer(
              `resolutions/pac-${fecId}`,
              `${titleCase(f.pac)} is the PAC of ${titleCase(targetNode.label)}.`,
              f.pac_url,
              "pac-connected-org: the PAC's connected organization is the lobbying client or the same company",
              [pacClaim, targetNode.claims[0]!],
              0.85,
            ),
          ],
          props: { method: "connected_org", reason: null },
        });
      }
    }
    const [first, last] = spans.get(`${fecId}|${id}`) ?? [null, null];
    if (!first || !last) continue;
    addEdge({
      kind: "funded",
      src: pacId,
      dst: id,
      basis: "fact",
      claims: [
        fact(
          `contributions/${fecId}:${m.bioguide}`,
          `${titleCase(f.pac)} gave ${usd(f.amount)} to ${title} ${m.name} in ${f.contributions} contribution${f.contributions === 1 ? "" : "s"}, ${first} to ${last}.`,
          f.url,
        ),
      ],
      props: { amountUsd: f.amount, contributions: f.contributions, first, last, allTxnsUrl: f.all_txns },
    });
  }
}

for (const l of G.lobbyists as { name: string; position: string; clients: string[]; url: string }[]) {
  const key = slug(l.name);
  const q = fact(`lda_lobbyists/${key}`, `${l.name}'s covered position, as filed.`, l.url, { quote: l.position });
  nodes.push({
    id: `lobbyist:${key}`,
    kind: "lobbyist",
    label: l.name,
    claims: [q],
    props: { ldaId: key, coveredPositions: [{ quote: l.position, claim: q }] },
  });
}

addEdge({
  kind: "inserted",
  src: "member:H000601",
  dst: `section:${s19.id}`,
  basis: "inference",
  claims: [
    infer(
      "amendment_sections/119-samdt-2307:sec-19",
      "§19 entered the bill through Sen. Hagerty's substitute SA 2307, the only amendment agreed in the step where it first appears.",
      sa.source,
      "inserted-via-substitute: the only agreed amendment in the version step where the section first appears",
      [amendmentClaim, s19.claims[0]],
      0.8,
    ),
  ],
  props: { amendmentId: "119-samdt-2307", how: "inferred" },
});

const lobbyTotalsClaim = fact(
  `lda_filings/${BILL}#totals`,
  `${G.lobbying.reports} LD-2 reports by ${G.lobbying.clients} clients and ${G.lobbying.registrants} firms named the bill; ${G.lobbying.lobbyists} lobbyists are listed on them.`,
  "https://lda.gov/filings/public/filing/c8cc8274-ed56-49f3-b56b-7dc2b132e4b2/print/",
  { sourceLocator: "count over every matched LD-2; one sample filing linked" },
);
const lobbyShareClaim = infer(
  `lda_filings/${BILL}#share`,
  `Estimated $${(G.lobbying.bill_share_estimate_usd / 1e6).toFixed(1)}M of the $${(G.lobbying.total_spend_on_quarters_usd / 1e6).toFixed(1)}M reported on those quarters went to this bill.`,
  "https://lda.gov/filings/public/filing/c8cc8274-ed56-49f3-b56b-7dc2b132e4b2/print/",
  "bill-share: each report's total split evenly over the issues it lists",
  [lobbyTotalsClaim],
  0.4,
);

const RULES_URL = "https://github.com/AVGVSTVS96/antibody/blob/main/spikes/REPORT.md";
const bundle = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  bill: {
    id: BILL,
    display: "S.1582",
    congress: 119,
    title: G.bill.full_title,
    shortTitle: "GENIUS Act",
    sponsor: "member:H000601",
    law: G.bill.law,
    lawOn: G.bill.signed,
    latestAction: "Became Public Law No: 119-27.",
    url: G.bill.url,
    billstatusUrl: G.bill.billstatus,
    claims: [billClaim],
  },
  versions,
  sections,
  votes,
  amendments,
  dollars: {
    estimates: [
      {
        id: "s1582-es",
        url: cbo.estimate_url,
        fileUrl: xlsx,
        archiveUrl: null,
        publishedOn: null,
        versionCode: "es",
        versionScored: "As passed by the Senate on June 17, 2025",
        baseline: "current-law",
        baselineLabel: "CBO current-law baseline",
        perSection: false,
        mandates: {
          privateSector: cbo.mandates.private_sector,
          intergovernmental: cbo.mandates.intergovernmental,
          claim: mandClaim,
        },
        claim: estClaim,
      },
    ],
    wholeBill: [
      dollarLine("deficit", cbo.deficit, deficit),
      dollarLine("outlays", cbo.outlays, outlays),
      dollarLine("revenues", cbo.revenues, revenues),
    ],
  },
  attention: {
    via: ["gnews"],
    outletListVersion: null,
    window: ["2025-02-01", "2025-10-01"],
    articles: G.attention.units.articles,
    general: {
      hits: G.attention.general_bucket_hits,
      pct: null,
      hitsByGroup: {},
      tradeLegalHits: 0,
      examples: [],
      claim: infer(
        `attention/${BILL}#general`,
        `${G.attention.general_bucket_hits} news units matched the bill as a whole better than any one section.`,
        "https://github.com/AVGVSTVS96/antibody/blob/main/spikes/attention/RESULTS.md",
        ATTN_RULE,
        [billClaim],
        0.5,
      ),
    },
  },
  lobbying: {
    reports: G.lobbying.reports,
    clients: G.lobbying.clients,
    registrants: G.lobbying.registrants,
    lobbyists: G.lobbying.lobbyists,
    byPhase: {
      bill: G.lobbying.by_phase.bill,
      enactmentQuarter: G.lobbying.by_phase["enactment-quarter"],
      law: G.lobbying.by_phase.law,
    },
    spendTotalUsd: G.lobbying.total_spend_on_quarters_usd,
    shareEstimateUsd: G.lobbying.bill_share_estimate_usd,
    claims: [lobbyTotalsClaim, lobbyShareClaim],
  },
  nodes,
  edges,
  claims,
  gaps: [
    {
      id: "paper-filings",
      kind: "paper_filings_unread",
      text: `Paper filings not yet read: ${(
        G.trades.paper_unread as { name: string; party: string; pages: number | null }[]
      )
        .map((p) => `${p.name} (${p.party})`)
        .join(", ")}. Until the vision step reads them, member trade lists are incomplete.`,
      nodes: [],
      claim: null,
    },
    {
      id: "no-section-dollars",
      kind: "no_section_dollars",
      text: "CBO scored only the whole bill, so no section has its own dollar figure.",
      nodes: [],
      claim: estClaim,
    },
    {
      id: "attention-partial",
      kind: "attention_partial",
      text: "News attention here comes from Google News RSS only (1 of 5 known fights found). Most coverage is law-firm explainers, so read the ranks as weak.",
      nodes: [],
      claim: null,
    },
    {
      id: "entity-recall",
      kind: "entity_recall",
      text: "15 of 53 lobbying clients have no public parent company (trade groups, Tether, Kraken, Paxos), so they have no stock to trade.",
      nodes: [],
      claim: null,
    },
  ],
  rules: [
    {
      id: "buried",
      version: "0",
      text: `Buried candidate: first appears after the first chamber text, and news attention percentile <= ${QUIET}.`,
      url: RULES_URL,
    },
    {
      id: "headline",
      version: "0",
      text: `Headline: news attention percentile >= ${HEADLINE} among this bill's scored sections.`,
      url: RULES_URL,
    },
    {
      id: "tied-stock",
      version: "1",
      text: "A company is tied to a bill if it lobbied on it (LDA) or is named in its text.",
      url: RULES_URL,
    },
    { id: "pac", version: "0", text: G.pac.rule, url: RULES_URL },
  ],
};

const parsed = Bundle.parse(bundle);
const problems = checkBundle(parsed);
if (problems.length) throw new Error(`fixture has ${problems.length} problems:\n${problems.slice(0, 20).join("\n")}`);
const out = join(ROOT, "apps/web/fixtures/119-s-1582.bundle.json");
writeFileSync(out, `${JSON.stringify(parsed)}\n`);
console.log(
  `${out}: ${parsed.sections.length} sections, ${parsed.nodes.length} nodes, ${parsed.edges.length} edges, ${Object.keys(parsed.claims).length} claims`,
);
