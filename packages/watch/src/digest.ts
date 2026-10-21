import { type BillId, billDisplay, billstatusUrl, congressGovUrl } from "@antibody/core";
import { auditParties, type MovedBill, type PartyAudit } from "./audit.ts";
import { type BillEvent, STEPS } from "./events.ts";
import { isSpecialRule } from "./rules.ts";
import { FLAG_CUTOFF, MAX_FLAGGED, RULE_TEXT, RULES_VERSION, type Signal, WEIGHTS } from "./score.ts";
import { type Deploy, SITE_URL } from "./site.ts";
import type { Candidate, WatchResult } from "./watch.ts";

export interface Reason {
  signal: Signal;
  text: string;
  url: string;
}

/**
 * Bills at the cutoff, best first, at most `max`. A House rule is never flagged on its score: its votes are
 * party-line and a day after it is filed by design, so it is listed only for its riders (`withRiders`).
 */
export const flaggedOf = (cs: Candidate[], max = MAX_FLAGGED) =>
  cs.filter((c) => !isSpecialRule(c.status) && c.score >= FLAG_CUTOFF).slice(0, max);

/** The cap keeps a day's digest readable; a sweep of a whole Congress flags every bill at the cutoff. */
export const flagCap = (r: { sweep?: number | null }) => (r.sweep ? Number.POSITIVE_INFINITY : MAX_FLAGGED);

/** House rules with a section that does more than set up debate, newest first. */
export const withRiders = (cs: Candidate[]) =>
  cs
    .filter((c) => c.evidence.riders?.length)
    .sort(
      (a, b) =>
        (b.events[0]?.date ?? "").localeCompare(a.events[0]?.date ?? "") || a.status.id.localeCompare(b.status.id),
    );

/** What happened to a rule on the floor: its strongest step, with the vote. */
const ruleOutcome = (c: Candidate) => {
  const top = c.events.find((e) => e.step === c.facts.step);
  return top
    ? `${STEPS[top.step].label} on ${fmtDate(top.date)}${top.tally ? ` (${top.tally.yeas}-${top.tally.nays})` : ""}`
    : "no floor action";
};

export const movedBills = (cs: Candidate[], max = MAX_FLAGGED): MovedBill[] => {
  const flagged = new Set(flaggedOf(cs, max));
  return cs
    .filter((c) => !isSpecialRule(c.status))
    .map((c) => ({
      bill: c.status.id,
      party: c.status.sponsor?.party || "unknown",
      score: c.score,
      flagged: flagged.has(c),
    }));
};
export const DETAILED = 5;

const SIGNALS = Object.keys(WEIGHTS) as Signal[];
const num = (n: number) => n.toLocaleString("en-US");
const fmtDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** samdt2307 → S.Amdt.2307, hamdt12 → H.Amdt.12 */
const amendmentDisplay = (id: string) => id.replace(/^samdt/, "S.Amdt.").replace(/^hamdt/, "H.Amdt.");

export function money(musd: number): string {
  const abs = Math.abs(musd);
  const s = abs >= 1e6 ? `$${(abs / 1e6).toFixed(2)}T` : abs >= 1e3 ? `$${(abs / 1e3).toFixed(1)}B` : `$${num(abs)}M`;
  return `${musd < 0 ? "−" : "+"}${s}`;
}

/** A whole-bill deficit figure in words; under half a million dollars is no measurable effect, not "+$0M". */
export function deficitEffect(musd: number): string {
  if (Math.abs(musd) < 0.5) return "no measurable effect on the deficit";
  return `${musd < 0 ? "cuts the deficit by" : "adds"} ${money(Math.abs(musd)).slice(1)}${musd < 0 ? "" : " to the deficit"}`;
}

/** Why the bill was flagged, one line per signal that fired, each with its source. Same templates for every bill. */
export function reasons(c: Candidate): Reason[] {
  const { facts: f, evidence: ev, status: s } = c;
  const out: Reason[] = [];
  const step = (e: BillEvent) =>
    `${STEPS[e.step].label} on ${fmtDate(e.date)}${e.tally ? ` (${e.tally.yeas}-${e.tally.nays})` : ""}`;
  const top = c.events.find((e) => e.step === f.step)!;
  const now = c.events.filter((e) => c.fresh.has(e.id)).sort((a, b) => STEPS[b.step].weight - STEPS[a.step].weight)[0];
  const text = `${step(top)}${now && !c.fresh.has(top.id) ? `; new: ${step(now)}` : ""}`;
  out.push({ signal: "moving", text: `${text[0]!.toUpperCase()}${text.slice(1)}`, url: top.url });
  if (f.newsStories && ev.news)
    out.push({
      signal: "attention",
      text: `${num(f.newsStories)} news ${f.newsStories === 1 ? "story names" : "stories name"} it (left ${num(ev.news.bySide.left)}, center ${num(ev.news.bySide.center)}, right ${num(ev.news.bySide.right)}; sides weighted equally), ${fmtDate(ev.news.start)} to ${fmtDate(ev.news.end)}`,
      url: ev.news.url,
    });
  if (f.deficitMusd !== null && ev.xray?.deficit)
    out.push({
      signal: "dollars",
      text: `CBO: ${deficitEffect(f.deficitMusd)} over ${ev.xray.deficit.period} (baseline: ${ev.xray.deficit.baselineLabel})`,
      url: ev.xray.deficit.url,
    });
  const buried = ev.xray?.buried ?? [];
  if (buried.length)
    out.push({
      signal: "buried",
      text: `${buried.length} section${buried.length > 1 ? "s" : ""} labeled buried (inference), led by ${sectionLine(buried[0]!)}`,
      url: buried[0]!.url || congressGovUrl(s.id),
    });
  if (f.lateSections) {
    const x = ev.xray?.lateSections;
    out.push(
      ev.lateFrom === "x-ray" && x
        ? {
            signal: "late",
            text: `${f.lateSections} section${f.lateSections > 1 ? "s first appear" : " first appears"} after the first chamber passed it${x[0] ? `, e.g. Sec. ${x[0].num} "${x[0].heading}"` : ""}`,
            url: x[0]?.url || ev.newest?.xmlUrl || congressGovUrl(s.id),
          }
        : {
            signal: "late",
            text: `${f.lateSections} section${f.lateSections > 1 ? "s" : ""} in the ${ev.newest!.name} text have headings not in the ${ev.before!.name} text, the last before the first floor vote${ev.newSectionSamples[0] ? `, e.g. Sec. ${ev.newSectionSamples[0]}` : ""}`,
            url: ev.newest!.xmlUrl,
          },
    );
  }
  if (f.lobbyingFilings)
    out.push({
      signal: "lobbying",
      text:
        ev.lobbyingFrom === "x-ray"
          ? `${num(f.lobbyingFilings)} lobbying filing${f.lobbyingFilings === 1 ? "" : "s"} name${f.lobbyingFilings === 1 ? "s" : ""} it${ev.lobbyingClients !== null ? ` (${num(ev.lobbyingClients)} client${ev.lobbyingClients === 1 ? "" : "s"})` : ""}`
          : `${num(f.lobbyingFilings)} lobbying filing${f.lobbyingFilings === 1 ? "" : "s"} cite${f.lobbyingFilings === 1 ? "s" : ""} its number (read ${num(ev.lobbyingChecked?.checked ?? 0)} of ${num(ev.lobbyingChecked?.searched ?? 0)} search hits${ev.lobbyingChecked && ev.lobbyingChecked.checked < ev.lobbyingChecked.searched ? `, so at least ${num(f.lobbyingFilings)}` : ""}; the x-ray also matches names)`,
      url: ev.lobbyingUrls.at(-1) ?? congressGovUrl(s.id),
    });
  const clock = ev.clock;
  if (clock && clock.days <= 14 && ev.firstVote)
    out.push({
      signal: "rushed",
      text: `Floor vote on ${fmtDate(clock.voteOn)}, ${clock.days === 0 ? "the same day as" : `${clock.days} day${clock.days === 1 ? "" : "s"} after`} ${clock.from === "introduced" ? "the bill was introduced" : `substitute amendment ${amendmentDisplay(clock.from)} was submitted`}`,
      url: ev.firstVote.url,
    });
  if (f.closedRule)
    out.push({
      signal: "rushed",
      text: "Brought to the House floor under a closed rule (no amendments allowed)",
      url: `${congressGovUrl(s.id)}/all-actions`,
    });
  if (f.closestVote && c.sub.divisive !== null && c.sub.divisive >= 0.8)
    out.push({
      signal: "divisive",
      text: `Close vote: ${f.closestVote.yeas}-${f.closestVote.nays}${ev.closestVoteOn ? ` (${ev.closestVoteOn})` : ""}`,
      url: ev.closestVoteUrl ?? congressGovUrl(s.id),
    });
  if (f.words && f.words >= 20_000)
    out.push({
      signal: "size",
      text: `${f.wordsCounted ? "" : "about "}${num(f.words)} words in the ${ev.newest?.name ?? "newest"} text`,
      url: ev.newest?.xmlUrl ?? congressGovUrl(s.id),
    });
  return out;
}

function sectionLine(b: NonNullable<NonNullable<Candidate["evidence"]["xray"]>["buried"]>[number]): string {
  const bits = [
    b.dollarsMusd !== null ? money(b.dollarsMusd) : null,
    b.attentionPct !== null ? `${Math.round(b.attentionPct * 100)}% of news` : null,
    b.lobbyingFirms ? `${b.lobbyingFirms} lobbying ${b.lobbyingFirms === 1 ? "firm" : "firms"}` : null,
    ...(b.reach ?? []).map((k) => `legal reach: ${k}`),
    b.late ? "added late" : null,
  ].filter(Boolean);
  return `Sec. ${b.num}${b.heading ? ` "${b.heading}"` : ""}${bits.length ? ` (${bits.join(", ")})` : ""}`;
}

export interface Links {
  page: string | null;
  congress: string;
  billstatus: string;
  actions: string;
  text: string | null;
}

/** The bill's page on the live site once its bundle is published; ANTIBODY_PAGE_URL (with `{id}`) overrides the address. */
export const pageUrl = (id: BillId, published = true) =>
  published ? (process.env.ANTIBODY_PAGE_URL ?? `${SITE_URL}/bill/{id}`).replace("{id}", id) : null;

export function links(c: Candidate): Links {
  const id = c.status.id;
  return {
    page: pageUrl(id, c.evidence.xray?.published ?? false),
    congress: congressGovUrl(id),
    billstatus: billstatusUrl(id),
    actions: `${congressGovUrl(id)}/all-actions`,
    text: c.evidence.newest?.xmlUrl ?? null,
  };
}

const byParty = (cs: Candidate[]) => {
  const out: Record<string, number> = {};
  for (const c of cs) {
    const p = c.status.sponsor?.party || "unknown";
    out[p] = (out[p] ?? 0) + 1;
  }
  return out;
};

export function digestJson(r: WatchResult, earlier: MovedBill[][] = []) {
  const flagged = flaggedOf(r.candidates, flagCap(r));
  const moved = movedBills(r.candidates, flagCap(r));
  const best = r.candidates.find((c) => !flagged.includes(c));
  return {
    schema: 1,
    sweep: r.sweep ?? null,
    date: r.date,
    since: r.since,
    actionsSince: r.actionsSince,
    generatedAt: r.generatedAt,
    rules: { version: RULES_VERSION, weights: WEIGHTS, text: RULE_TEXT },
    moved: r.candidates.length,
    alreadyReported: r.alreadyReported,
    xrayed: r.xrayed,
    site: r.site,
    cutoff: { score: FLAG_CUTOFF, max: r.sweep ? null : MAX_FLAGGED },
    belowCutoff: r.candidates.length - flagged.length,
    highestBelow: best && { display: billDisplay(best.status.id), score: best.score },
    movedBills: moved,
    ruleRiders: withRiders(r.candidates).map((c) => ({
      bill: c.status.id,
      display: billDisplay(c.status.id),
      title: c.status.title,
      outcome: ruleOutcome(c),
      riders: c.evidence.riders!,
      links: links(c),
    })),
    partyAudit: auditParties([...earlier, moved]),
    movedBySponsorParty: byParty(r.candidates),
    flaggedBySponsorParty: byParty(flagged),
    flagged: flagged.map((c, i) => ({
      rank: i + 1,
      bill: c.status.id,
      display: billDisplay(c.status.id),
      title: c.status.title,
      shortTitle: c.status.shortTitle,
      sponsor: c.status.sponsor,
      policyArea: c.status.policyArea,
      score: c.score,
      subScores: c.sub,
      facts: c.facts,
      reasons: reasons(c),
      events: c.events.slice(0, 8).map(({ id, kind, step, date, text, url, tally }) => ({
        kind,
        step,
        date,
        text,
        url,
        tally,
        new: c.fresh.has(id),
      })),
      xray: c.xray && {
        ...c.xray,
        bundle: c.evidence.xray?.bundle ?? null,
        published: c.evidence.xray?.published ?? false,
        buried: c.evidence.xray?.buried ?? null,
        lateSections: c.evidence.xray?.lateSections ?? null,
        headlineHits: c.evidence.xray?.headlineHits ?? null,
      },
      links: links(c),
    })),
    sources: r.sources,
    problems: r.problems,
  };
}

export type Digest = ReturnType<typeof digestJson>;

const tally = (counts: Record<string, number>) =>
  Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([p, n]) => `${p} ${n}`)
    .join(" · ") || "none";

function auditLine(
  a: PartyAudit,
  d: { flaggedBySponsorParty: Record<string, number>; movedBySponsorParty: Record<string, number> },
) {
  const rows = a.parties.map(
    (p) => `${p.party} ${p.flagged} of ${p.moved} flagged (${Math.round(p.rate * 100)}%, mean score ${p.meanScore})`,
  );
  return `Party symmetry audit, last ${a.days} digest day${a.days === 1 ? "" : "s"}, ${a.bills} distinct moved bills by sponsor party, flagged and not: ${rows.join(" · ") || "none"}. ${a.verdict} Today: flagged ${tally(d.flaggedBySponsorParty)} of moved ${tally(d.movedBySponsorParty)}.`;
}

const deployText = (d: Deploy) => {
  switch (d.status) {
    case "pending":
      return "deploy not finished";
    case "deployed":
      return `deployed to ${d.url}`;
    case "unchanged":
      return "live site already matches, not redeployed";
    case "disabled":
      return "not deployed (turned off)";
    case "failed":
      return `deploy failed (${d.error}), the previous live site is unchanged`;
  }
};

const siteLine = ({ published, deploy }: Digest["site"]) =>
  `Site: ${published.length ? `published ${published.map((b) => billDisplay(b)).join(", ")}` : "no new bundles published"} · ${deployText(deploy)}`;

const cell = (v: number | null) => (v === null ? "—" : v.toFixed(2));

export function digestMarkdown(d: Digest): string {
  const L: string[] = [];
  if (d.sweep) {
    L.push(`# antibody sweep · ${d.sweep}th Congress · ${d.date}`, "");
    L.push(
      `Every bill of the ${d.sweep}th Congress scored on its whole record since ${d.since} · ${d.moved} bills had floor or committee action · rules ${d.rules.version}`,
    );
  } else {
    L.push(`# antibody watch · ${d.date}`, "");
    L.push(
      `Window: records updated ${d.since} → ${d.date}, actions dated from ${d.actionsSince} · ${d.moved} bills moved with new events (${d.alreadyReported} more were in an earlier digest) · rules ${d.rules.version}`,
    );
  }
  if (d.xrayed.length) L.push(`X-rayed: ${d.xrayed.map((b) => billDisplay(b as BillId)).join(", ")}`);
  L.push(siteLine(d.site));
  if (d.problems.length)
    L.push("", `**${d.problems.length} problem${d.problems.length > 1 ? "s" : ""}** (see the end)`);
  if (!d.flagged.length)
    L.push(
      "",
      d.moved
        ? `Nothing reached the cutoff of ${d.cutoff.score}.${d.highestBelow ? ` Highest: ${d.highestBelow.display} at ${d.highestBelow.score}.` : ""}`
        : "Nothing new moved in this window.",
    );

  for (const b of d.flagged.slice(0, DETAILED)) {
    L.push("", `## ${b.rank}. ${b.display} · ${b.shortTitle ?? b.title}`, "");
    const sponsor = b.sponsor ? `${b.sponsor.name}` : "no sponsor listed";
    L.push(`Score **${b.score}** · ${sponsor}${b.policyArea ? ` · ${b.policyArea}` : ""}`, "");
    for (const r of b.reasons) L.push(`- ${r.text} ([source](${r.url}))`);
    L.push("", `Sub-scores: ${SIGNALS.map((k) => `${k} ${cell(b.subScores[k])}`).join(" · ")}`);
    if (b.xray)
      L.push(
        b.xray.ok
          ? `X-ray: done in ${b.xray.seconds}s${b.xray.headlineHits !== null ? ` · ${b.xray.headlineHits} news articles on the bill as a whole` : ""}${b.xray.bundle ? ` · bundle ${b.xray.bundle}` : " · no bundle yet"}`
          : `X-ray: failed (${b.xray.error}) · log ${b.xray.log}`,
      );
    const l = b.links;
    L.push(
      "",
      [
        l.page ? `[page](${l.page})` : "page: not published yet",
        `[congress.gov](${l.congress})`,
        `[actions](${l.actions})`,
        l.text ? `[newest text](${l.text})` : null,
        `[BILLSTATUS](${l.billstatus})`,
      ]
        .filter(Boolean)
        .join(" · "),
    );
  }

  const rest = d.flagged.slice(DETAILED);
  if (rest.length) {
    L.push("", "## Also moving", "", `| # | bill | score | ${SIGNALS.join(" | ")} | why |`);
    L.push(`|---|---|---|${SIGNALS.map(() => "---").join("|")}|---|`);
    for (const b of rest)
      L.push(
        `| ${b.rank} | [${b.display}](${b.links.congress}) ${(b.shortTitle ?? b.title).slice(0, 60)} | ${b.score} | ${SIGNALS.map((k) => cell(b.subScores[k])).join(" | ")} | ${b.reasons[0]?.text ?? ""} |`,
      );
  }

  if (d.ruleRiders.length) {
    L.push("", "## Riders in House rules", "");
    L.push(
      "A rule sets up debate on other measures. These rules also carry a section that does something else; each is found by its wording, the same patterns for every rule.",
    );
    for (const r of d.ruleRiders) {
      L.push(
        "",
        `### ${r.display} · ${r.outcome}`,
        "",
        `${r.title.slice(0, 200)} ([text](${r.links.text ?? r.links.congress}), [actions](${r.links.actions}))`,
        "",
      );
      for (const x of r.riders) L.push(`- **${x.label}** (Sec. ${x.section}): "${x.quote}"`);
    }
  }

  L.push("", "## How bills are ranked", "");
  L.push(
    `Score = 100 × Σ weight × sub-score; an unmeasured sub-score (—) counts as 0. A bill is flagged at ${d.cutoff.score} or more${d.cutoff.max === null ? "" : ` (at most ${d.cutoff.max})`}; ${d.belowCutoff} of ${d.moved} moved bills scored below. The sponsor's party is never an input.`,
    "",
    auditLine(d.partyAudit, d),
    "",
  );
  for (const k of SIGNALS) L.push(`- **${k}** (${Math.round(d.rules.weights[k] * 100)}%): ${d.rules.text[k]}`);

  L.push("", "## Sources", "");
  for (const s of d.sources)
    L.push(`- ${s.ok ? "ok" : "FAILED"} · [${s.name}](${s.url}) · ${s.ok ? `${s.items} in window` : s.error}`);
  if (d.problems.length) {
    L.push("", "## Problems", "");
    for (const p of d.problems) L.push(`- ${p}`);
  }
  return `${L.join("\n")}\n`;
}
