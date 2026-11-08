import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Bundle, checkBundle, Edge, Node, must } from "@antibody/core";
import type { Claim } from "@antibody/core";
import { DATA, paths, readRows, ROOT } from "@antibody/core/node";
import { DuckDBInstance } from "@duckdb/node-api";
import L from "../fixtures/genius-source/genius-s1582.sections.json";
import G from "../fixtures/genius-source/genius.json";

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
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const versionByCode = new Map(G.versions.map((v) => [v.code, v]));

const version = (code: string) => {
  const v = versionByCode.get(code);

  if (!v) {
    throw new Error(`no version ${code} in genius.json`);
  }

  return v;
};

const enr = version("enr");

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

const versions = G.versions.map((v) => {
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
});

interface VersionText {
  path: string;
  heading: string;
  words: number;
  match?: string;
  similarity?: number;
  diff_from_prev?: { words_added: number; words_removed: number; largest_inserts: string[] };
}

const lineage = new Map(L.sections.map((s) => [s.versions.enr?.path.split(":")[1] ?? s.id, s]));

const HEADLINE = 0.85;
const QUIET = 0.25;

const ATTN_RULE =
  "attention v0: Google News RSS headlines, articles and paragraphs matched to sections by embedding; percentile within this bill";

const sections = G.sections.map((s) => {
  const lin = lineage.get(String(s.num));

  if (!lin) {
    throw new Error(`no lineage for section ${s.num}`);
  }

  const first = version(lin.first_version);
  const firstPath = Object.entries(lin.versions).find(([code]) => code === lin.first_version)?.[1].path;

  if (firstPath === undefined) {
    throw new Error(`${lin.id} has no text in ${lin.first_version}`);
  }

  const secClaim = fact(
    `sections/${lin.id}`,
    `§${s.num} "${s.heading}" first appears in ${first.name} (${first.date}).`,
    first.url,
    { sourceLocator: firstPath.replace("sec:", "section ") },
  );

  const textClaim = fact(
    `sections/${lin.id}#final`,
    `§${s.num} "${s.heading}" is in the enrolled text: ${s.words.toLocaleString("en-US")} words.`,
    enr.url,
    { sourceLocator: `section ${s.num}` },
  );

  let attention = null;

  if (s.attention_pct !== null) {
    const examples = [];

    if (s.attention_example !== null) {
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
      "https://github.com/AVGVSTVS96/antibody/blob/a879985/spikes/attention/RESULTS.md",
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
        buried: label === "buried" ? 1 - attention.pct : null,
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
    Object.entries<VersionText>(lin.versions).map(([code, v]) => [
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
});

const ROLL = /vote_119_1_0*(\d+)\.xml|roll(\d+)\.xml/u;

const votes = G.bill.votes.flatMap((v) => {
  const m = ROLL.exec(v.url);

  if (!m) {
    return [];
  }

  const senate = m[1] !== undefined;
  const number = Number(m[1] ?? m[2]);
  const tally = must(/(\d+)-(\d+)/u.exec(v.label), `a tally in "${v.label}"`);
  const yeas = Number(tally[1]);
  const nays = Number(tally[2]);

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

  return [
    {
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
    },
  ];
});

const finalRoll = new Map(votes.map((v) => [v.url, v.id]));

const sa = must(G.amendments_agreed[0], "an agreed amendment");

const s19 = must(
  sections.find((s) => s.num === "19"),
  "section 19",
);

const lateIds = sections.flatMap((s) => (s.late ? [s.id] : []));

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
  ...must(claims[amendmentClaim], "the SA 2307 claim"),
  id: "roll_calls/senate-119-1-311",
  text: "Senate roll call 311: SA 2307 agreed to, 67-30.",
  sourceUrl: "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1191/vote_119_1_00311.xml",
  quote: null,
};

const cbo = G.cbo;
const xlsx = must(cbo.cite.split(" ")[0], "the CBO table URL");
const locator = /\((.*)\)/u.exec(cbo.cite)?.[1] ?? null;

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

const addEdge = (e: { kind: string; src: string; dst: string; basis: string; claims: string[]; props: object }) => {
  const id = `${e.kind}:${e.src}->${e.dst}`;

  if (edgeIds.has(id)) {
    return;
  }

  edgeIds.add(id);
  edges.push(Edge.parse({ ...e, id }));
};

const bill = `bill:${BILL}`;

const COMMITTEES = new Map([
  ["House Financial Services", { code: "HSBA", chamber: "House" }],
  ["Senate Banking, Housing, and Urban Affairs", { code: "SSBK", chamber: "Senate" }],
]);

const COMMITTEE_URL = "https://theunitedstates.io/congress-legislators/committee-membership-current.yaml";

for (const [name, c] of COMMITTEES) {
  nodes.push(
    Node.parse({
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
    }),
  );
}

addEdge({
  kind: "referred",
  src: bill,
  dst: "committee:SSBK",
  basis: "fact",
  claims: [fact(`bill_committees/${BILL}:SSBK`, "S.1582 went to the Senate Banking Committee.", G.bill.billstatus)],
  props: { activity: null },
});

const titleCase = (s: string) =>
  s === s.toUpperCase()
    ? s.toLowerCase().replaceAll(/(^|[\s(&-])(\w)/gu, (_m, a: string, b: string) => a + b.toUpperCase())
    : s;

const lobbiedRule = (topicOnly: boolean) =>
  topicOnly
    ? "topic-only lobbying: the filing describes the bill's subject without naming it"
    : "named-the-bill: the LD-2 issue text names S.1582, S.394, S.919 or the GENIUS Act";

for (const c of G.companies) {
  const clientName = c.resolution?.client ?? c.clients[0] ?? c.label;
  const key = slug(clientName);
  const clientId = `client:${key}`;

  const clientClaim = fact(
    `lda_clients/${key}`,
    `${titleCase(clientName)} filed ${c.filings} LD-2 report${c.filings === 1 ? "" : "s"} naming the bill.`,
    c.lobby_url,
    { quote: c.issue_text },
  );

  nodes.push(
    Node.parse({
      id: clientId,
      kind: "client",
      label: titleCase(c.public ? clientName : c.label),
      claims: [clientClaim],
      props: { names: c.clients.length > 0 ? c.clients : [clientName], ldaClientIds: [], description: null },
    }),
  );
  const phases = { bill: 0, enactmentQuarter: 0, law: 0 };

  for (const p of c.phases ?? []) {
    if (p === "bill") {
      phases.bill = 1;
    }

    if (p === "enactment-quarter") {
      phases.enactmentQuarter = 1;
    }

    if (p === "law") {
      phases.law = 1;
    }
  }

  const topicOnly = c.issue_text === null || c.issue_text === "" || !/1582|394|919|GENIUS/iu.test(c.issue_text);

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
    c.share_est === null
      ? null
      : infer(
          `lda_bill_refs/${key}#share`,
          `Estimated ${usd(c.share_est)} of ${usd(c.spend_total ?? 0)} total spend on the quarters naming the bill went to it.`,
          c.lobby_url,
          "bill-share: each report's total split evenly over the issues it lists",
          [refClaim],
          0.4,
        );

  addEdge({
    kind: "lobbied",
    src: clientId,
    dst: bill,
    basis: topicOnly ? "inference" : "fact",
    claims: shareClaim === null ? [refClaim] : [refClaim, shareClaim],
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

  if (c.public && c.sec_url !== null && c.sec_url !== "" && c.resolution !== null) {
    const cik = must(c.id.split(":")[1], `a CIK in ${c.id}`);
    const companyId = `company:${cik}`;

    const coClaim = fact(
      `companies/${cik}`,
      `${titleCase(c.label)} is SEC registrant CIK ${cik}${c.ticker !== null && c.ticker !== "" ? `, ticker ${c.ticker}` : ""}.`,
      c.sec_url,
    );

    nodes.push(
      Node.parse({
        id: companyId,
        kind: "company",
        label: c.label,
        claims: [coClaim],
        props: { cik, tickers: c.ticker !== null && c.ticker !== "" ? [c.ticker] : [], secUrl: c.sec_url },
      }),
    );

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

const OWNER = new Map([
  ["self", "self"],
  ["Self", "self"],
  ["SP", "spouse"],
  ["Spouse", "spouse"],
  ["JT", "joint"],
  ["Joint", "joint"],
  ["DC", "dependent"],
]);

const TYPE = (t: string) =>
  /partial/iu.test(t) ? "sale_partial" : /sale/iu.test(t) ? "sale" : /exchange/iu.test(t) ? "exchange" : "purchase";

const members = await readRows("members");

if (members.length === 0) {
  throw new Error(`no member rows in ${paths.table("members")}/*.jsonl: run the members stage first`);
}

const memberRows = new Map(members.map((r) => [r.id, r]));

const paperNames = new Set(G.trades.paper_unread.map((p) => p.name));

const db = await (
  await DuckDBInstance.create(join(DATA, "entities/genius.duckdb"), { access_mode: "READ_ONLY" })
).connect();

const spanRows = (
  await db.runAndReadAll("SELECT CMTE_ID, member, min(dt)::VARCHAR, max(dt)::VARCHAR FROM fec_pas2 GROUP BY 1, 2")
).getRows();

const spans = new Map(spanRows.map((r) => [`${String(r[0])}|${String(r[1])}`, [String(r[2]), String(r[3])] as const]));

const companyNodes = new Set<string>(nodes.flatMap((n) => (n.kind === "company" ? [n.id] : [])));

const clientOfCompany = new Map<string, string>(
  edges.flatMap((e) => (e.kind === "resolves_to" ? [[e.dst, e.src] as const] : [])),
);

const pacs = new Map<string, string>();

for (const m of G.members) {
  const id = `member:${m.bioguide}`;
  const row = memberRows.get(m.bioguide);
  const state = m.state ?? row?.state ?? "";
  const district = m.chamber === "House" ? (row?.district ?? null) : null;
  const title = m.chamber === "Senate" ? "Sen." : "Rep.";

  const memberClaim = fact(
    `members/${m.bioguide}`,
    `${title} ${m.name} (${m.party}-${state}), ${m.chamber}.`,
    `https://bioguide.congress.gov/search/bio/${m.bioguide}`,
  );

  nodes.push(
    Node.parse({
      id,
      kind: "member",
      label: `${title} ${m.name} (${m.party}-${state}${district !== null && district !== 0 ? `-${district}` : ""})`,
      claims: [memberClaim],
      props: {
        bioguide: m.bioguide,
        party: m.party,
        state,
        district,
        chamber: m.chamber,
        paperFilingsUnread: paperNames.has(m.name),
      },
    }),
  );

  if (m.role === "sponsored") {
    addEdge({
      kind: "sponsored",
      src: id,
      dst: bill,
      basis: "fact",
      claims: [sponsorClaim],
      props: { role: "sponsor", date: "2025-05-01", withdrawnOn: null },
    });
  }

  for (const c of m.committees) {
    const cm = COMMITTEES.get(c.committee);

    if (!cm) {
      continue;
    }

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

  const rollId = m.vote_url === null ? undefined : finalRoll.get(m.vote_url);

  if (m.vote !== null && m.vote !== "" && m.vote_url !== null && m.vote_url !== "" && rollId !== undefined) {
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
      props: { rollId, vote: m.vote },
    });
  }

  const byCompany = new Map<string, typeof m.trades>();

  for (const t of m.trades) {
    byCompany.set(t.company, [...(byCompany.get(t.company) ?? []), t]);
  }

  for (const [company, ts] of byCompany) {
    if (!companyNodes.has(company)) {
      continue;
    }

    const events = ts.map((t, i) => {
      const doc = /(\d{8})\.pdf|ptr\/([0-9a-f-]+)\/?$/u.exec(t.source);
      const docId = doc?.[1] ?? doc?.[2] ?? slug(t.source);
      const owner = OWNER.get(t.owner) ?? "self";
      const whose = owner === "self" ? "" : owner === "joint" ? " (jointly held)" : ` (${owner}'s)`;

      return {
        date: t.date,
        type: TYPE(t.type),
        amount: t.amount,
        owner,
        ticker: t.ticker,
        asset: t.ticker,
        readBy: t.source.endsWith(".pdf") ? "text" : "html",
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
      dst: company,
      basis: "fact",
      claims: events.map((e) => e.claim),
      props: { events },
    });
  }

  for (const f of m.funding) {
    const fecId = must(/committee\/(C\d+)/u.exec(f.pac_url)?.[1], `an FEC id in ${f.pac_url}`);
    const pacId = `pac:${fecId}`;

    if (!pacs.has(fecId)) {
      pacs.set(fecId, f.company);
      const pacClaim = fact(`pacs/${fecId}`, `${titleCase(f.pac)} is FEC committee ${fecId}.`, f.pac_url);
      nodes.push(
        Node.parse({
          id: pacId,
          kind: "pac",
          label: titleCase(f.pac),
          claims: [pacClaim],
          props: { fecId, connectedOrg: null, subsidiaryOf: null },
        }),
      );

      const target =
        f.company.startsWith("company:") && companyNodes.has(f.company)
          ? f.company
          : (clientOfCompany.get(f.company) ?? f.company);

      const targetNode = nodes.find((n) => n.id === target);

      if (targetNode && (targetNode.kind === "company" || targetNode.kind === "client")) {
        addEdge({
          kind: "resolves_to",
          src: pacId,
          dst: target,
          basis: "inference",
          claims: [
            infer(
              `resolutions/pac-${fecId}`,
              `${titleCase(f.pac)} is the PAC of ${titleCase(targetNode.label)}.`,
              f.pac_url,
              "pac-connected-org: the PAC's connected organization is the lobbying client or the same company",
              [pacClaim, must(targetNode.claims[0], `a claim on ${targetNode.id}`)],
              0.85,
            ),
          ],
          props: { method: "connected_org", reason: null },
        });
      }
    }

    const [first, last] = spans.get(`${fecId}|${id}`) ?? [null, null];

    if (first === null || first === "" || last === null || last === "") {
      continue;
    }

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
      props: {
        cutoff: last,
        cutoffKind: "enactment",
        beforeUsd: f.amount,
        afterUsd: 0,
        amountUsd: f.amount,
        contributions: f.contributions,
        first,
        last,
        allTxnsUrl: f.all_txns,
      },
    });
  }
}

for (const l of G.lobbyists) {
  const key = slug(l.name);
  const q = fact(`lda_lobbyists/${key}`, `${l.name}'s covered position, as filed.`, l.url, { quote: l.position });
  nodes.push(
    Node.parse({
      id: `lobbyist:${key}`,
      kind: "lobbyist",
      label: l.name,
      claims: [q],
      props: { ldaId: key, coveredPositions: [{ quote: l.position, claim: q }] },
    }),
  );
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
      [amendmentClaim, must(s19.claims[0], "the section 19 claim")],
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

const RULES_URL = "https://github.com/AVGVSTVS96/antibody/blob/a879985/spikes/REPORT.md";

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
        "https://github.com/AVGVSTVS96/antibody/blob/a879985/spikes/attention/RESULTS.md",
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
      text: `Paper filings not yet read: ${G.trades.paper_unread
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

if (problems.length > 0) {
  throw new Error(`fixture has ${problems.length} problems:\n${problems.slice(0, 20).join("\n")}`);
}

const out = join(ROOT, "apps/web/fixtures/119-s-1582.bundle.json");

writeFileSync(out, `${JSON.stringify(parsed)}\n`);

console.log(
  `${out}: ${parsed.sections.length} sections, ${parsed.nodes.length} nodes, ${parsed.edges.length} edges, ${Object.keys(parsed.claims).length} claims`,
);
