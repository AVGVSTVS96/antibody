import { type Bundle, billStats, type Dollar, headlineDeficit, type NodeId, type Owner } from "@antibody/core";
import { count, day, deficitWords, nice, plainName, usd } from "../lib/format.ts";
import type { BillModel, SectionView } from "../lib/model.ts";
import { daysBetween, medianPerTrader, tradeBook, windowShare } from "../lib/trades.ts";

export const GROUPS = ["left", "center-left", "center", "center-right", "right"] as const;
export type Group = (typeof GROUPS)[number];
export const GROUP_SHORT: Record<Group, string> = {
  left: "LEFT",
  "center-left": "CTR-L",
  center: "CENTER",
  "center-right": "C-R",
  right: "RIGHT",
};

/** attention-v1: a bill with fewer than these shows raw counts and no ranking. */
export const RANK_MIN = { articles: 20, mentions: 30 };

export type Estimate = Bundle["dollars"]["estimates"][number];

const hitsOf = (v: SectionView) => v.s.attention?.hits ?? 0;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const finals = (m: BillModel) => m.sections.filter((v) => v.s.inFinal);
const pct = (a: number, b: number) => Math.round((100 * a) / b);

export const shortDay = (iso: string) => day(iso).replace(/, \d{4}$/, "");
const year = (iso: string) => iso.slice(0, 4);

/** `$3.39T`, `$12.5B`, `$254B`, `$120M`: the unsigned size of CBO millions, three digits at most. The one money format of the story. */
export function bigUsd(m: number): string {
  const a = Math.abs(m);
  if (a >= 1e6) return `$${(a / 1e6).toFixed(2)}T`;
  if (a >= 1e3) return `$${a < 1e5 ? (a / 1e3).toFixed(1) : Math.round(a / 1e3).toLocaleString("en-US")}B`;
  return `$${Math.round(a)}M`;
}

/** `+$3.39T`, `−$12.5B`: the same size with its sign always spelled out. */
export const figure = (m: number) => `${m < 0 ? "−" : "+"}${bigUsd(m)}`;

/** Client spending with one decimal: `$41.2M`. */
export function spend(n: number): string {
  const [unit, div] = n >= 1e9 ? ["B", 1e9] : n >= 1e6 ? ["M", 1e6] : ["K", 1e3];
  return `$${(n / div).toFixed(n >= div * 100 ? 0 : 1)}${unit}`;
}

/** Digits joined by a hyphen (`2023-2032`, `P.L. 117-169`) with a non-breaking one, so a number never splits across lines. */
export const glue = (s: string) => s.replace(/(?<=\d)-(?=\d)/g, "\u2011");

export function listAnd(xs: string[], word = "and"): string {
  if (xs.length < 3) return xs.join(` ${word} `);
  return `${xs.slice(0, -1).join(", ")} ${word} ${xs.at(-1)}`;
}

export interface HeadLine {
  text: string;
  tone?: "label" | "big";
}

export interface Chapter<T> {
  head: HeadLine[];
  lede: string;
  /** Every sentence the chapter shows as prose: the reading time is counted from it. */
  read: string[];
  data: T;
}

const chapter = <T>(head: HeadLine[], lede: string, data: T, ...more: (string | undefined)[]): Chapter<T> => ({
  head,
  lede,
  data,
  read: [head.map((l) => l.text).join(" "), lede, ...more.filter((s): s is string => !!s)],
});

const gapText = (b: Bundle, test: (g: Bundle["gaps"][number]) => boolean) => b.gaps.find(test)?.text ?? null;

/**
 * A gap sentence that counts "N lobbying clients", labelled when N is not the bundle's own client count, so two
 * unexplained totals never share a screen. Bundles that count clients one way pass through unchanged.
 */
function pooled(b: Bundle, sentence: string | null): string | null {
  const pool = Number(/ of ([\d,]+) lobbying clients/.exec(sentence ?? "")?.[1]?.replaceAll(",", ""));
  if (!sentence || !pool || pool === b.lobbying.clients) return sentence;
  return `${sentence} (${pool.toLocaleString("en-US")} counts every client in the filings the bundle read, including ones that only touch the bill's topic; ${b.lobbying.clients.toLocaleString("en-US")} is the clients whose filings name the bill.)`;
}

/** The first sentence of a gap's text. */
const firstSentence = (s: string) => s.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? s;

const ruleOf = (b: Bundle, id: string) => b.rules.find((r) => r.id === id) ?? null;

/** Why the quiet-and-costly rule could not run on this bill, or null when it did: every chapter that would state a quiet-section result says this instead. */
const untestedWhy = (b: Bundle) => {
  const { tested, why } = billStats(b).buriedTest;
  return tested ? null : (why ?? "the rule could not run on it");
};

export { ruleOf };

// Chapter 1: the headline fight

export interface Ch1Data {
  articles: number;
  mentions: number;
  ranked: boolean;
  rows: SectionView[];
  groups: { group: Group; hits: number }[];
  outletList: string | null;
  /** The box that hands over to chapter 2: a figure and the sentence under it. */
  handoff: { value: string; text: string };
  claims: string[];
}

export function ch1(m: BillModel): Chapter<Ch1Data> {
  const b = m.b;
  const stats = billStats(b);
  const fin = finals(m);
  const articles = b.attention.sample?.relevant ?? b.attention.articles;
  const mentions = sum(fin.map(hitsOf));
  const ranked = fin.some((v) => v.s.attention?.pct != null);
  const headline = m.headline;
  const quietHits = sum(m.buried.map(hitsOf));
  const groups = GROUPS.map((group) => ({
    group,
    hits: sum(fin.map((v) => v.s.attention?.hitsByGroup[group] ?? 0)),
  }));
  const rows = (ranked ? headline.slice(0, 7) : fin.filter((v) => hitsOf(v) > 0))
    .toSorted((x, y) => hitsOf(y) - hitsOf(x))
    .slice(0, 7);

  let head: HeadLine[];
  let lede: string;
  if (!ranked)
    [head, lede] = [
      [{ text: "Too few articles" }, { text: "to rank sections.", tone: "label" }],
      `We found ${count(b.attention.sample?.found ?? b.attention.articles, "article")} and judged ${articles.toLocaleString("en-US")} to be about the bill. Together they named a section ${count(mentions, "time")}. Ranking sections needs at least ${RANK_MIN.articles} articles and ${RANK_MIN.mentions} mentions, so we show counts and no ranking.`,
    ];
  else if (!headline.length)
    [head, lede] = [
      [{ text: "The loud fight:" }, { text: "no section", tone: "label" }, { text: "stood out." }],
      `We read ${articles.toLocaleString("en-US")} articles about the bill. Together they named a section ${count(mentions, "time")}, spread so evenly that no section reached the top tenth by coverage with at least 3 articles.`,
    ];
  else {
    const share = pct(stats.mentions!.headline, Math.max(stats.mentions!.total, 1));
    [head, lede] = [
      [
        { text: "The loud fight:" },
        { text: count(headline.length, "section"), tone: "label" },
        { text: `took ${share}%.` },
      ],
      `We read ${articles.toLocaleString("en-US")} articles about the bill. Together they named a section ${mentions.toLocaleString("en-US")} times. ${stats.mentions!.headline.toLocaleString("en-US")} of those mentions landed on ${headline.length} of the ${fin.length} sections in the final law.`,
    ];
  }

  const untested = untestedWhy(b);
  const handoff = untested
    ? { value: "—", text: `We couldn't test this bill for quiet sections: ${untested}. Next chapter.` }
    : m.buried.length
      ? {
          value: String(quietHits),
          text: `${quietHits === 1 ? "mention" : "mentions"} reached the ${m.buried.length} sections that went through quietly. Next chapter.`,
        }
      : { value: "0", text: "No section met the quiet-and-costly rule. Next chapter says what came closest." };

  return chapter(
    head,
    lede,
    {
      articles,
      mentions,
      ranked,
      rows,
      groups,
      outletList: b.attention.outletListVersion,
      handoff,
      claims: rows.flatMap((v) => (v.s.attention ? [v.s.attention.claim] : [])),
    },
    `${handoff.value} ${handoff.text}`,
    mentions
      ? `Outlet groups come from one published outlet list${b.attention.outletListVersion ? ` (${b.attention.outletListVersion})` : ""}. They describe the outlet, not the bill, and carry no party color here.`
      : undefined,
  );
}

// Chapter 2: through quietly

export interface QuietRow {
  v: SectionView;
  /** The section's CBO figure and whether it is CBO's own or an even share of a group line. */
  musd: number | null;
  evenSplit: boolean;
}

export interface Ch2Data {
  rows: QuietRow[];
  scale: number;
  articles: number;
  hits: number;
  measured: number;
  addedMusd: number;
  cutMusd: number;
  /** Set when there are none: why, in one sentence. */
  closest: SectionView | null;
  tested: boolean;
  estimateClaims: string[];
}

function versionSentence(m: BillModel, rows: SectionView[]): string {
  const by = new Map<string, number>();
  for (const v of rows) by.set(v.s.firstVersion, (by.get(v.s.firstVersion) ?? 0) + 1);
  const named = [...by].map(([code, n]) => {
    const ver = m.versions.find((x) => x.code === code);
    return { n, text: ver ? `${ver.name}${ver.date ? ` (${day(ver.date)})` : ""}` : code };
  });
  if (named.length === 1) return `${rows.length === 1 ? "It" : "They"} first appeared in the ${named[0]!.text} text.`;
  return `They first appeared in ${listAnd(named.map((x) => `${x.n} in the ${x.text} text`))}.`;
}

const quietWord = (v: SectionView) => {
  const why = [
    v.dollarsMusd != null && v.s.score?.components.dollarsSplit !== "even_split" ? deficitWords(v.dollarsMusd) : null,
    v.named ? `${count(v.named, "lobbying report")} name it` : null,
  ].filter(Boolean);
  return why.length ? why.join(" and ") : "had the highest quiet-and-costly score";
};

export function ch2(m: BillModel): Chapter<Ch2Data> {
  const b = m.b;
  const stats = billStats(b);
  const articles = b.attention.sample?.relevant ?? b.attention.articles;
  const all = [...m.buried].sort(
    (x, y) => Math.abs(y.dollarsMusd ?? 0) - Math.abs(x.dollarsMusd ?? 0) || x.s.num.localeCompare(y.s.num),
  );
  const rows = all.map((v): QuietRow => ({ v, musd: v.dollarsMusd, evenSplit: v.figure?.split === "even_split" }));
  const hits = sum(all.map(hitsOf));
  const scale = Math.max(1, ...rows.map((r) => Math.abs(r.musd ?? 0)));
  const { addedMusd, cutMusd, measured } = stats.quietCost;
  const estimateClaims = [
    ...new Set(
      all.flatMap((v) => (v.figure && !rows.find((r) => r.v === v)?.evenSplit ? [v.figure.estimate.claim] : [])),
    ),
  ];
  const untested = untestedWhy(b);
  const closest =
    !all.length && !untested
      ? (m.sections
          .filter((v) => v.s.inFinal && v.kind !== "buried" && v.kind !== "headline" && (v.s.score?.buried ?? 0) > 0)
          .sort((x, y) => y.s.score!.buried! - x.s.score!.buried!)[0] ?? null)
      : null;

  const data: Ch2Data = {
    rows,
    scale,
    articles,
    hits,
    measured,
    addedMusd,
    cutMusd,
    closest,
    tested: stats.buriedTest.tested,
    estimateClaims,
  };
  const n = all.length;

  if (!n) {
    const dollars = !stats.buriedTest.dollarsMeasured
      ? " CBO gave no section its own dollar figure, so only lobbying could show big stakes."
      : "";
    if (untested)
      return chapter(
        [{ text: "We couldn't test" }, { text: "this bill for", tone: "label" }, { text: "quiet sections." }],
        `The quiet-and-costly rule did not run: ${untested}.${dollars}`,
        data,
      );
    const near = closest ? ` Closest: ${m.secLabel(closest)} ${closest.s.heading}, which ${quietWord(closest)}.` : "";
    return chapter(
      [{ text: "No section" }, { text: "went through", tone: "label" }, { text: "quietly." }],
      `None of the ${stats.sections} sections had big stakes, little coverage and a late or off-topic arrival all at once.${near}${dollars}`,
      data,
    );
  }

  const late = all.filter((v) => v.s.late).length;
  const lateLine = b.bill.lateUnavailable
    ? `Whether they came late cannot be told for this bill: ${b.bill.lateUnavailable}`
    : `${late === n ? (n === 1 ? "It" : `All ${n}`) : `${late} of the ${n}`} ${late === 1 ? "was" : "were"} added late, after a chamber had passed the bill. ${versionSentence(m, all)}`;
  const press = hits
    ? `They drew ${count(hits, "mention")} in the ${articles.toLocaleString("en-US")} articles we read.`
    : `${n === 1 ? "It was" : "None was"} mentioned in the ${articles.toLocaleString("en-US")} articles we read.`;
  const adds = rows.filter((r) => r.musd != null && !r.evenSplit && r.musd > 0).length;
  const cuts = rows.filter((r) => r.musd != null && !r.evenSplit && r.musd < 0).length;
  const net = addedMusd - cutMusd;
  const cbo = measured
    ? `CBO prices ${[adds && `${adds} at ${bigUsd(addedMusd)} more deficit`, cuts && `${cuts} at ${bigUsd(cutMusd)} less`].filter(Boolean).join(" and ")}${adds && cuts ? `: a net ${net < 0 ? "cut" : "addition"} of ${bigUsd(net)}` : ""}.${measured < n ? ` ${n - measured} have no CBO figure of their own and qualified through lobbying.` : ""}`
    : "CBO gave none of them its own dollar figure; they qualified through lobbying.";

  return chapter(
    [
      { text: `${count(n, "section")}.` },
      {
        text: `${hits ? count(hits, "mention") : `0 of ${articles.toLocaleString("en-US")} articles`}.`,
        tone: "label",
      },
      ...(measured ? [{ text: `${bigUsd(addedMusd + cutMusd)} of changes.` }] : []),
    ],
    `${lateLine} ${press} ${cbo}`,
    data,
  );
}

// Chapter 3: what it costs

export interface Baseline {
  d: Dollar;
  est: Estimate;
  label: string;
}

export interface SectionDollar {
  v: SectionView;
  musd: number;
  evenSplit: boolean;
}

export interface Ch3Data {
  baselines: Baseline[];
  quietTested: boolean;
  kicker: string | null;
  movement: { loud: number; quiet: number; other: number } | null;
  added: number;
  cut: number;
  figured: number;
  biggest: SectionDollar[];
  byKind: Record<"loud" | "quiet" | "other", SectionDollar[]>;
  sectionSum: number;
  /** CBO's whole-bill figure on the baseline the section lines are on, and how far the section lines fall from it. */
  billTotal: number | null;
  gap: number | null;
  noFigure: number;
  evenSplit: number;
  sectionBaseline: Estimate | null;
  directOnly: boolean;
  gaps: string[];
}

export const ch3Head = (b: Baseline, shown = b.d.amountMusd): HeadLine[] => [
  { text: bigUsd(shown), tone: "big" },
  { text: `${b.d.amountMusd < 0 ? "cut from" : "added to"} deficits.`, tone: "label" },
];

export function ch3(m: BillModel): Chapter<Ch3Data> {
  const b = m.b;
  const stats = billStats(b);
  const baselines = (["current-law", "current-policy"] as const).flatMap((k): Baseline[] => {
    const d = headlineDeficit(b, k);
    const est = d && b.dollars.estimates.find((e) => e.id === d.estimateId);
    return d && est ? [{ d, est, label: est.baselineLabel }] : [];
  });
  const fin = finals(m);
  const figured = fin.flatMap((v): SectionDollar[] =>
    v.dollarsMusd == null ? [] : [{ v, musd: v.dollarsMusd, evenSplit: v.figure?.split === "even_split" }],
  );
  const kindOf = (v: SectionView) => (v.kind === "headline" ? "loud" : v.kind === "buried" ? "quiet" : "other");
  const byKind = { loud: [] as SectionDollar[], quiet: [] as SectionDollar[], other: [] as SectionDollar[] };
  for (const s of figured) byKind[kindOf(s.v)].push(s);
  const gross = (xs: SectionDollar[]) => sum(xs.map((s) => Math.abs(s.musd)));
  const added = sum(figured.filter((s) => s.musd > 0).map((s) => s.musd));
  const cut = sum(figured.filter((s) => s.musd < 0).map((s) => -s.musd));
  const sectionSum = added - cut;
  const law = baselines.find((x) => x.d.baseline === "current-law");
  const estimates = figured.flatMap((s) => (s.v.figure ? [s.v.figure.estimate] : []));
  const sectionBaseline = estimates.length
    ? [...new Set(estimates)].sort(
        (x, y) => estimates.filter((e) => e === y).length - estimates.filter((e) => e === x).length,
      )[0]!
    : null;
  const comparable = law && sectionBaseline?.baseline === "current-law" ? law : null;

  const data: Ch3Data = {
    baselines,
    quietTested: stats.buriedTest.tested,
    kicker: baselines[0] ? `CBO · ${baselines[0].est.versionScored} · ${baselines[0].d.period}` : null,
    movement: figured.length
      ? { loud: gross(byKind.loud), quiet: gross(byKind.quiet), other: gross(byKind.other) }
      : null,
    added,
    cut,
    figured: figured.length,
    biggest: [...figured].sort((x, y) => Math.abs(y.musd) - Math.abs(x.musd)).slice(0, 10),
    byKind,
    sectionSum,
    billTotal: comparable?.d.amountMusd ?? null,
    gap: comparable ? comparable.d.amountMusd - sectionSum : null,
    noFigure: fin.length - figured.length,
    evenSplit: figured.filter((s) => s.evenSplit).length,
    sectionBaseline,
    directOnly: stats.deficitDirectOnly,
    gaps: b.gaps.filter((g) => g.kind === "no_section_dollars").map((g) => g.text),
  };

  const first = baselines[0];
  if (!first) {
    const none = !b.dollars.estimates.length;
    const lede = none
      ? (data.gaps[0] ?? "No CBO cost estimate is loaded for this bill, so no dollar figures show here.")
      : `CBO published ${count(b.dollars.estimates.length, "estimate")} for this bill, but none has a whole-bill deficit line we could read, so there is no total to show.`;
    return chapter(
      [{ text: none ? "No CBO estimate" : "No CBO total" }, { text: "for this bill.", tone: "label" }],
      lede,
      data,
    );
  }
  const verb = (d: Dollar) => `${d.amountMusd < 0 ? "cuts" : "adds"} ${bigUsd(d.amountMusd)}`;
  const lede =
    baselines.length === 2
      ? `CBO scored the law against two baselines. Against the ${baselines[0]!.label} it ${verb(baselines[0]!.d)}. Against the ${baselines[1]!.label} it ${verb(baselines[1]!.d)}. The baseline changes the answer, so both stay on screen.`
      : `CBO scored the bill against one baseline: the ${first.label}. It ${verb(first.d)} ${first.d.amountMusd < 0 ? "from" : "to"} the deficit over ${first.d.period}.`;
  const direct = data.directOnly
    ? " CBO's total covers only direct spending and revenue; the bill's discretionary appropriations are not in it."
    : "";
  return chapter(ch3Head(first), lede + direct, data);
}

// Chapter 4: who lobbied

export interface ClientRow {
  id: NodeId;
  name: string;
  reports: number;
  spendUsd: number | null;
  phases: { bill: number; enactmentQuarter: number; law: number };
  claims: string[];
}

export interface Ch4Data {
  reports: number;
  phases: Bundle["lobbying"]["byPhase"];
  lawName: string | null;
  clients: ClientRow[];
  mentions: number;
  landed: number;
  sections: number;
  top: { v: SectionView; reports: number }[];
  topMax: number;
  unmentioned: number;
  topCount: number;
  articles: number;
  claims: string[];
  limited: string | null;
}

const reportsOf = (v: SectionView) => v.named;

export function ch4(m: BillModel): Chapter<Ch4Data> {
  const b = m.b;
  const L = b.lobbying;
  const fin = finals(m);
  const clients = m.actors
    .map((a): ClientRow => {
      const edges = a.lobbied.filter((e) => e.dst.startsWith("bill:"));
      const spends = edges.flatMap((e) => (e.props.spendTotalUsd == null ? [] : [e.props.spendTotalUsd]));
      return {
        id: a.id,
        name: nice(a.label),
        reports: sum(edges.map((e) => e.props.reports)),
        spendUsd: spends.length ? sum(spends) : null,
        phases: {
          bill: sum(edges.map((e) => e.props.phases.bill)),
          enactmentQuarter: sum(edges.map((e) => e.props.phases.enactmentQuarter)),
          law: sum(edges.map((e) => e.props.phases.law)),
        },
        claims: edges.flatMap((e) => e.claims),
      };
    })
    .filter((c) => c.reports > 0)
    .sort((x, y) => y.reports - x.reports || (y.spendUsd ?? 0) - (x.spendUsd ?? 0) || x.name.localeCompare(y.name))
    .slice(0, 10);
  const named = fin.filter((v) => reportsOf(v) > 0).sort((x, y) => reportsOf(y) - reportsOf(x));
  const mentions = sum(named.map(reportsOf));
  const topThree = named.slice(0, 3);
  const unmentioned = topThree.filter((v) => v.s.attention != null && hitsOf(v) === 0).length;
  const articles = b.attention.sample?.relevant ?? b.attention.articles;
  const data: Ch4Data = {
    reports: L.reports,
    phases: L.byPhase,
    lawName: b.bill.law,
    clients,
    mentions,
    landed: named.length,
    sections: fin.length,
    top: named.slice(0, 7).map((v) => ({ v, reports: reportsOf(v) })),
    topMax: named[0] ? reportsOf(named[0]) : 1,
    unmentioned,
    topCount: topThree.length,
    articles,
    claims: L.claims,
    limited: pooled(
      b,
      gapText(b, (g) => g.id === "clients-limited"),
    ),
  };

  if (!L.reports)
    return chapter(
      [{ text: "No lobbying report" }, { text: "names this bill.", tone: "label" }],
      "No lobbying disclosure in the bundle cites this bill.",
      data,
    );
  const spend = L.spendTotalUsd
    ? ` Their filings report ${usd(L.spendTotalUsd)} of spending. That total covers every issue on each filing, not just this bill.`
    : "";
  const where = mentions
    ? `Filings named a section number ${mentions.toLocaleString("en-US")} times; a report that names two sections counts twice. Those mentions land on ${landedOf(named.length, fin.length)}. Every other mention names only the bill.`
    : "No filing names a section number: every mention names only the bill.";
  const near = unmentioned
    ? `${unmentioned === topThree.length ? `All ${unmentioned}` : `${unmentioned} of the ${topThree.length}`} most-named sections drew no mentions in the ${articles.toLocaleString("en-US")} articles read.`
    : undefined;
  return chapter(
    [
      { text: L.reports.toLocaleString("en-US"), tone: "big" },
      { text: `lobbying ${L.reports === 1 ? "report" : "reports"}`, tone: "label" },
      { text: "named this bill." },
    ],
    `${count(L.clients, "client")} hired ${count(L.registrants, "lobbying firm")}.${spend}`,
    data,
    where,
    near,
  );
}

export const landedOf = (k: number, n: number) =>
  `${k.toLocaleString("en-US")} of ${n.toLocaleString("en-US")} sections`;

// Chapter 5: who's tied

export interface TiedMember {
  id: NodeId;
  name: string;
  trades: number;
}

export interface Tie {
  id: NodeId;
  name: string;
  ticker: string | null;
  sections: SectionView[];
  members: TiedMember[];
  /** Lobbying filings that name the quiet sections, the company's listing, and the trades dated in the window. */
  claims: string[];
  listing: string[];
  tradeClaims: string[];
}

export interface Ch5Data {
  ties: Tie[];
  shown: Tie[];
  rest: Tie[];
  restTraded: boolean;
  listed: number;
  recall: string | null;
  window: [string, string] | null;
}

const tiedWhole = (n: number) =>
  n
    ? `${count(n, "listed company", "listed companies")} ${n === 1 ? "is" : "are"} tied to the bill as a whole because ${n === 1 ? "it" : "they"} lobbied on it.`
    : "No listed company is tied to the bill as a whole either.";

export function ch5(m: BillModel): Chapter<Ch5Data> {
  const b = m.b;
  const book = tradeBook(m);
  const quiet = new Map(m.buried.map((v) => [v.s.id, v]));
  const byCompany = new Map<NodeId, { sections: Set<SectionView>; claims: Set<string> }>();
  for (const e of m.edges) {
    if (e.kind !== "lobbied" || !e.dst.startsWith("section:")) continue;
    const v = quiet.get(e.dst.slice(8));
    const a = m.actorById.get(e.src);
    if (!v || a?.kind !== "company") continue;
    const entry = byCompany.get(a.id as NodeId) ?? { sections: new Set(), claims: new Set() };
    entry.sections.add(v);
    for (const c of e.claims) entry.claims.add(c);
    byCompany.set(a.id as NodeId, entry);
  }
  const ties = [...byCompany].map(([id, { sections, claims }]): Tie => {
    const a = m.actorById.get(id)!;
    const trades = (book.byCompany.get(id) ?? []).filter((t) => t.inWindow);
    const per = new Map<NodeId, number>();
    for (const t of trades) per.set(t.member, (per.get(t.member) ?? 0) + 1);
    return {
      id,
      name: plainName(a.label, 40),
      ticker: a.ticker,
      sections: [...sections].sort((x, y) => x.s.num.localeCompare(y.s.num, undefined, { numeric: true })),
      members: [...per]
        .map(([mid, n]) => ({ id: mid, name: m.memberById.get(mid)!.node.label, trades: n }))
        .sort((x, y) => y.trades - x.trades || x.name.localeCompare(y.name)),
      claims: [...claims],
      listing: a.node.claims,
      tradeClaims: trades.map((t) => t.event.claim),
    };
  });
  ties.sort(
    (x, y) =>
      y.members.length - x.members.length || y.sections.length - x.sections.length || x.name.localeCompare(y.name),
  );
  const withMembers = ties.filter((t) => t.members.length);
  const shown = ties.slice(0, Math.max(8, Math.min(withMembers.length, 12)));
  const rest = ties.slice(shown.length);
  const listed = b.nodes.filter((n) => n.kind === "company").length;
  const recall = gapText(b, (g) => g.kind === "entity_recall");
  const data: Ch5Data = {
    ties,
    shown,
    rest,
    restTraded: rest.some((t) => t.members.length),
    listed,
    recall: pooled(b, recall && firstSentence(recall)),
    window: m.span,
  };

  const untested = untestedWhy(b);
  if (untested)
    return chapter(
      listed
        ? [
            { text: String(listed), tone: "big" },
            { text: `listed ${listed === 1 ? "company" : "companies"}` },
            { text: "lobbied on this bill." },
          ]
        : [{ text: "No listed company" }, { text: "lobbied on this bill.", tone: "label" }],
      `We couldn't test for quiet sections, so none can be tied to one: ${untested}.${listed ? ` ${listed === 1 ? "It is" : "They are"} tied to the bill as a whole because ${listed === 1 ? "it" : "they"} lobbied on it.` : ""}`,
      data,
    );
  if (!ties.length)
    return chapter(
      [{ text: "No listed company" }, { text: "named a quiet section.", tone: "label" }],
      m.buried.length
        ? `${count(listed, "listed company", "listed companies")} ${listed === 1 ? "is" : "are"} tied to the bill because ${listed === 1 ? "it" : "they"} lobbied on it, but none named one of the ${m.buried.length} quiet sections in its own filings.`
        : `The bill has no quiet sections, so no company can be tied to one. ${tiedWhole(listed)}`,
      data,
    );
  const nums = listAnd(
    [...new Set(ties.flatMap((t) => t.sections.map((v) => m.secLabel(v))))].sort((x, y) =>
      x.localeCompare(y, undefined, { numeric: true }),
    ),
    "or",
  );
  const lede = `${count(listed, "listed company", "listed companies")} are tied to the bill because they lobbied on it. ${ties.length === 1 ? "This one also names" : `These ${ties.length} also named`} ${m.buried.length === 1 ? "the quiet section" : "one of the quiet sections"} (${nums}) in their own filings. A tie is a rule, not a finding that the bill helped them.`;
  const floor = `Companies are matched by name, so ${ties.length} is a floor.${data.recall ? ` ${data.recall}` : ""}`;
  return chapter(
    [
      { text: String(ties.length), tone: "big" },
      { text: `listed ${ties.length === 1 ? "company" : "companies"}` },
      { text: "named a quiet section." },
    ],
    lede,
    data,
    floor,
  );
}

// Chapter 6: who traded

export interface Milestone {
  letter: string;
  date: string;
  text: string;
  url: string | null;
  claim: string | null;
}

export interface Leader {
  id: NodeId;
  label: string;
  trades: number;
  owners: { owner: Owner; trades: number }[];
}

export interface Ch6Data {
  window: [string, string] | null;
  days: string[];
  perDay: number[];
  peak: { date: string; trades: number } | null;
  trades: number;
  traders: number;
  byParty: { R: number; D: number; I: number };
  leaders: Leader[];
  milestones: Milestone[];
  all: ReturnType<typeof windowShare>;
  median: number;
  tradedAll: number;
  tradedBill: number;
  claims: string[];
  gaps: Bundle["gaps"];
}

export function ch6(m: BillModel): Chapter<Ch6Data> {
  const b = m.b;
  const book = tradeBook(m);
  const win = book.window;
  const inWin = book.all.filter((t) => t.inWindow);
  const days: string[] = [];
  if (win)
    for (let i = 0, n = daysBetween(win[0], win[1]); i < n; i++)
      days.push(new Date(Date.parse(`${win[0]}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
  const perDay = days.map((d) => inWin.filter((t) => t.event.date === d).length);
  const peakAt = perDay.reduce((best, n, i) => (n > perDay[best]! ? i : best), 0);
  const traders = new Set(inWin.map((t) => t.member));
  const byParty = { R: 0, D: 0, I: 0 };
  for (const id of traders) byParty[m.memberById.get(id)!.node.props.party]++;

  const per = new Map<NodeId, Leader>();
  for (const t of inWin) {
    const l = per.get(t.member) ?? { id: t.member, label: "", trades: 0, owners: [] };
    l.trades++;
    const o = l.owners.find((x) => x.owner === t.event.owner);
    if (o) o.trades++;
    else l.owners.push({ owner: t.event.owner, trades: 1 });
    per.set(t.member, l);
  }
  const leaders = [...per.values()]
    .map((l) => ({ ...l, label: leaderLabel(m, l.id) }))
    .sort((x, y) => y.trades - x.trades || x.label.localeCompare(y.label))
    .slice(0, 6);

  const drawn = new Set(b.edges.flatMap((e) => (e.kind === "voted" ? [e.props.rollId] : [])));
  const milestones: Milestone[] = b.votes
    .filter((v) => drawn.has(v.id))
    .sort((x, y) => x.date.localeCompare(y.date) || x.number - y.number)
    .map((v) => ({
      letter: "",
      date: v.date,
      text: `${v.chamber === "House" ? "House" : "Senate"} ${v.result.replace(/ \(.*$/, "").toLowerCase()} ${v.yeas}-${v.nays}${/tie broken/i.test(v.result) ? ", VP breaks tie" : ""}`,
      url: v.url,
      claim: v.claim,
    }));
  if (b.bill.lawOn)
    milestones.push({
      letter: "",
      date: b.bill.lawOn,
      text: `Signed${b.bill.law ? `, ${b.bill.law}` : ""}`,
      url: b.bill.url,
      claim: b.bill.claims[0] ?? null,
    });
  milestones.forEach((x, i) => {
    x.letter = String.fromCharCode(65 + i);
  });

  const data: Ch6Data = {
    window: win,
    days,
    perDay,
    peak: days.length ? { date: days[peakAt]!, trades: perDay[peakAt]! } : null,
    trades: inWin.length,
    traders: traders.size,
    byParty,
    leaders,
    milestones: milestones.filter((x) => win && x.date >= win[0] && x.date <= win[1]),
    all: windowShare(book),
    median: medianPerTrader(book),
    tradedAll: book.byMember.size,
    tradedBill: m.members.length,
    claims: inWin.map((t) => t.event.claim),
    gaps: b.gaps.filter((g) => g.kind === "paper_filings_unread" || g.id === "non-stock-trades"),
  };

  if (!win || !inWin.length)
    return chapter(
      [{ text: "No member" }, { text: "traded a tied stock", tone: "label" }, { text: "in the window." }],
      win
        ? `No trade in a company tied to this bill is dated from the first text (${day(win[0])}) through signing (${day(win[1])}).${book.all.length ? ` ${count(book.all.length, "trade")} fall outside that window.` : ""}`
        : "This bill has no dated text, so there is no window to count trades in.",
      data,
    );
  const parties = listAnd(
    (["R", "D", "I"] as const).flatMap((p) =>
      byParty[p] ? [count(byParty[p], { R: "Republican", D: "Democrat", I: "independent" }[p])] : [],
    ),
  );
  const range =
    year(win[0]) === year(win[1]) ? `${shortDay(win[0])} and ${day(win[1])}` : `${day(win[0])} and ${day(win[1])}`;
  return chapter(
    [
      { text: String(traders.size), tone: "big" },
      { text: `${count(traders.size, "member").replace(/^\d+ /, "")} traded`, tone: "label" },
      { text: "tied stocks." },
    ],
    `Between ${range}, ${parties} made ${count(inWin.length, "trade")} in companies that lobbied on this bill. Same rule for every party.`,
    data,
  );
}

const leaderLabel = (m: BillModel, id: NodeId) => m.memberById.get(id)!.node.label.replace(/^(Sen|Rep)\.\s+/, "");
