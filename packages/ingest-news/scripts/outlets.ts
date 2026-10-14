#!/usr/bin/env bun
/**
 * Builds data/outlets.json, the published outlet list. Run it again only to cut a new list version.
 *
 *   bun packages/ingest-news/scripts/outlets.ts <version>
 *
 * Inputs are public: Media Cloud's directory and its 2019 US partisanship collections.
 */
import { join } from "node:path";
import { paths } from "@antibody/core/node";
import { collectionSources, countsBySource, type Source, sourceByDomain } from "../src/mediacloud.ts";
import { type Group, midpoint, type Partisan } from "../src/outlets.ts";

const QUINTILES: Record<Partisan, number> = {
  left: 200363061,
  "center-left": 200363048,
  center: 200363050,
  "center-right": 200363062,
  right: 200363049,
};

/** National outlets that cover Congress, across the spectrum. Inclusion is decided by the rules below, not by this list. */
const NEWS = [
  "rawstory.com",
  "alternet.org",
  "dailykos.com",
  "commondreams.org",
  "newrepublic.com",
  "salon.com",
  "slate.com",
  "thenation.com",
  "motherjones.com",
  "talkingpointsmemo.com",
  "newyorker.com",
  "propublica.org",
  "ms.now",
  "huffpost.com",
  "nbcnews.com",
  "pbs.org",
  "vox.com",
  "time.com",
  "theweek.com",
  "theintercept.com",
  "theatlantic.com",
  "csmonitor.com",
  "npr.org",
  "theguardian.com",
  "cnn.com",
  "nytimes.com",
  "washingtonpost.com",
  "thedailybeast.com",
  "axios.com",
  "thehill.com",
  "abcnews.go.com",
  "cbsnews.com",
  "cnbc.com",
  "bloomberg.com",
  "businessinsider.com",
  "marketwatch.com",
  "rollcall.com",
  "usatoday.com",
  "latimes.com",
  "wsj.com",
  "nypost.com",
  "foxnews.com",
  "breitbart.com",
  "dailycaller.com",
  "townhall.com",
  "redstate.com",
  "washingtonexaminer.com",
  "washingtontimes.com",
  "reason.com",
  "realclearpolitics.com",
  "pjmedia.com",
  "hotair.com",
  "zerohedge.com",
  "justthenews.com",
  "freebeacon.com",
  "dailywire.com",
  "spectator.org",
  "oann.com",
  "theblaze.com",
  "newsmax.com",
  "nationalreview.com",
  "investors.com",
  "forbes.com",
  "newsweek.com",
  "epochtimes.com",
  "dailysignal.com",
  "thefederalist.com",
  "foxbusiness.com",
  "thefp.com",
];

/** Trade and legal press: shown apart from the news cycle, never counted in it. */
const TRADE_LEGAL = [
  "law360.com",
  "jdsupra.com",
  "natlawreview.com",
  "lexology.com",
  "bloomberglaw.com",
  "americanbanker.com",
  "coindesk.com",
  "cointelegraph.com",
  "decrypt.co",
  "pymnts.com",
  "statnews.com",
  "fiercehealthcare.com",
  "modernhealthcare.com",
  "healthcaredive.com",
  "biopharmadive.com",
  "fiercepharma.com",
  "utilitydive.com",
  "eenews.net",
  "agri-pulse.com",
  "agweb.com",
  "accountingtoday.com",
  "thinkadvisor.com",
  "freightwaves.com",
  "defensenews.com",
  "govexec.com",
  "federalnewsnetwork.com",
  "insidehighered.com",
  "spglobal.com",
];

/** Congress coverage windows used to check an outlet is actually collected (one before each big test bill). */
const PROBES = [
  { start: "2022-07-01", end: "2022-09-30" },
  { start: "2025-05-01", end: "2025-07-31" },
];
const MIN_CONGRESS_STORIES = 20;

if (import.meta.main) {
  const version = Bun.argv[2];
  if (!version) throw new Error("usage: outlets.ts <version>");
  const cache = join(paths.raw("news"), "mediacloud");

  const membership = new Map<number, Partisan[]>();
  for (const [q, id] of Object.entries(QUINTILES) as [Partisan, number][]) {
    for (const s of await collectionSources(id)) membership.set(s.id, [...(membership.get(s.id) ?? []), q]);
  }

  const found = new Map<string, Source | null>();
  for (const d of [...NEWS, ...TRADE_LEGAL]) found.set(d, await sourceByDomain(d));
  const ids = [...found.values()].flatMap((s) => (s ? [s.id] : []));

  const probes: Record<string, number>[] = [];
  for (const w of PROBES) probes.push(await countsBySource("Congress", ids, w));
  await Bun.write(join(cache, `outlets-${version}-probe.json`), JSON.stringify({ PROBES, probes }, null, 1));

  const outlets: object[] = [];
  const left: object[] = [];
  for (const d of [...NEWS, ...TRADE_LEGAL]) {
    const s = found.get(d);
    const quintiles = s ? (membership.get(s.id) ?? []) : [];
    const congress = probes.map((p) => p[d] ?? 0);
    const trade = TRADE_LEGAL.includes(d);
    const group: Group | null = trade ? "trade-legal" : midpoint(quintiles);
    const why = !s
      ? "not in the Media Cloud directory"
      : !trade && !group
        ? "no 2019 partisanship rating in Media Cloud"
        : !trade && Math.max(...congress) < MIN_CONGRESS_STORIES
          ? `fewer than ${MIN_CONGRESS_STORIES} Congress stories collected in each probe window`
          : null;
    const row = {
      domain: d,
      name: d,
      group,
      mediacloud_id: s?.id ?? null,
      quintiles,
      media_type: s?.media_type ?? null,
      congress_stories: congress,
    };
    if (why) left.push({ ...row, why });
    else outlets.push(row);
  }

  const list = {
    version,
    built: new Date().toISOString().slice(0, 10),
    rule: [
      "Counted outlets are US national news sites that cover Congress.",
      "An outlet's group is its Media Cloud 2019 US partisanship quintile: which politicians' followers shared its stories on Twitter (left, center-left, center, center-right, right). When Media Cloud lists an outlet in several quintiles, its group is the midpoint, rounded toward center.",
      `An outlet is counted only if Media Cloud collects it (at least ${MIN_CONGRESS_STORIES} stories mentioning Congress in one of the probe windows) and it has a partisanship rating.`,
      "Attention weighs the left side (left + center-left), the center, and the right side (center-right + right) equally, so no side counts more because it has more outlets or publishes more stories.",
      "Trade and legal press (law firms, industry and policy trade outlets) is collected and shown apart; it never counts toward attention.",
    ],
    sources: Object.fromEntries(
      Object.entries(QUINTILES).map(([q, id]) => [q, `https://search.mediacloud.org/collections/${id}`]),
    ),
    probes: PROBES,
    outlets,
    left_out: left,
  };
  const file = join(import.meta.dir, "../data/outlets.json");
  await Bun.write(file, `${JSON.stringify(list, null, 1)}\n`);
  const by: Record<string, number> = {};
  for (const o of outlets as { group: string }[]) by[o.group] = (by[o.group] ?? 0) + 1;
  console.log(file, by, "left out", left.length);
}
