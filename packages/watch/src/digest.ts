import { billDisplay, billstatusUrl, congressGovUrl } from "@antibody/core";
import type { BillId } from "@antibody/core";
import { auditParties } from "./audit.ts";
import type { MovedBill, PartyAudit } from "./audit.ts";
import { STEPS } from "./events.ts";
import type { BillEvent } from "./events.ts";
import { isSpecialRule } from "./rules.ts";
import { FLAG_CUTOFF, MAX_FLAGGED, RULE_TEXT, RULES_VERSION, SIGNALS, WEIGHTS } from "./score.ts";
import type { Signal } from "./score.ts";
import { SITE_URL } from "./site.ts";
import type { Deploy } from "./site.ts";
import type { Candidate, WatchResult } from "./watch.ts";

export interface Reason {
  signal: Signal;
  text: string;
  url: string;
}

export const flaggedOf = (cs: Candidate[], max = MAX_FLAGGED) =>
  cs.filter((c) => !isSpecialRule(c.status) && c.score >= FLAG_CUTOFF).slice(0, max);

const isSweep = (sweep: number | null | undefined) => sweep !== undefined && sweep !== null && sweep !== 0;

export const flagCap = (r: { sweep?: number | null }) => (isSweep(r.sweep) ? Number.POSITIVE_INFINITY : MAX_FLAGGED);

export const withRiders = (cs: Candidate[]) =>
  cs
    .filter((c) => (c.evidence.riders?.length ?? 0) > 0)
    .toSorted(
      (a, b) =>
        (b.events[0]?.date ?? "").localeCompare(a.events[0]?.date ?? "") || a.status.id.localeCompare(b.status.id),
    );

const stepLine = (e: BillEvent) =>
  `${STEPS[e.step].label} on ${fmtDate(e.date)}${e.tally ? ` (${e.tally.yeas}-${e.tally.nays})` : ""}`;

const ruleOutcome = (c: Candidate) => {
  const top = c.events.find((e) => e.step === c.facts.step);

  return top ? stepLine(top) : "no floor action";
};

const partyOf = (c: Candidate) => {
  const party = c.status.sponsor?.party ?? "";

  return party === "" ? "unknown" : party;
};

const isLink = (url: string | null | undefined): url is string => url !== undefined && url !== null && url !== "";

export const movedBills = (cs: Candidate[], max = MAX_FLAGGED): MovedBill[] => {
  const flagged = new Set(flaggedOf(cs, max));

  return cs.flatMap((c) =>
    isSpecialRule(c.status) ? [] : [{ bill: c.status.id, party: partyOf(c), score: c.score, flagged: flagged.has(c) }],
  );
};

export const DETAILED = 5;

const num = (n: number) => n.toLocaleString("en-US");

const fmtDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const amendmentDisplay = (id: string) => id.replace(/^samdt/u, "S.Amdt.").replace(/^hamdt/u, "H.Amdt.");

export function money(musd: number): string {
  const abs = Math.abs(musd);
  const s = abs >= 1e6 ? `$${(abs / 1e6).toFixed(2)}T` : abs >= 1e3 ? `$${(abs / 1e3).toFixed(1)}B` : `$${num(abs)}M`;

  return `${musd < 0 ? "−" : "+"}${s}`;
}

export function deficitEffect(musd: number): string {
  if (Math.abs(musd) < 0.5) {
    return "no measurable effect on the deficit";
  }

  return `${musd < 0 ? "cuts the deficit by" : "adds"} ${money(Math.abs(musd)).slice(1)}${musd < 0 ? "" : " to the deficit"}`;
}

export function reasons(c: Candidate): Reason[] {
  const { facts: f, evidence: ev, status: s } = c;
  const out: Reason[] = [];

  const top = c.events.find((e) => e.step === f.step);

  if (!top) {
    throw new Error(`${s.id}: no event at its step "${f.step}"`);
  }

  const now = c.events
    .filter((e) => c.fresh.has(e.id))
    .toSorted((a, b) => STEPS[b.step].weight - STEPS[a.step].weight)[0];

  const text = `${stepLine(top)}${now && !c.fresh.has(top.id) ? `; new: ${stepLine(now)}` : ""}`;
  out.push({ signal: "moving", text: `${text.charAt(0).toUpperCase()}${text.slice(1)}`, url: top.url });

  if (f.newsStories !== null && f.newsStories !== 0 && ev.news) {
    out.push({
      signal: "attention",
      text: `${num(f.newsStories)} news ${f.newsStories === 1 ? "story names" : "stories name"} it (left ${num(ev.news.bySide.left)}, center ${num(ev.news.bySide.center)}, right ${num(ev.news.bySide.right)}; sides weighted equally), ${fmtDate(ev.news.start)} to ${fmtDate(ev.news.end)}`,
      url: ev.news.url,
    });
  }

  if (f.deficitMusd !== null && ev.xray?.deficit) {
    out.push({
      signal: "dollars",
      text: `CBO: ${deficitEffect(f.deficitMusd)} over ${ev.xray.deficit.period} (baseline: ${ev.xray.deficit.baselineLabel})`,
      url: ev.xray.deficit.url,
    });
  }

  const buried = ev.xray?.buried ?? [];
  const [lead] = buried;

  if (lead) {
    out.push({
      signal: "buried",
      text: `${buried.length} section${buried.length > 1 ? "s" : ""} labeled buried (inference), led by ${sectionLine(lead)}`,
      url: isLink(lead.url) ? lead.url : congressGovUrl(s.id),
    });
  }

  if (f.lateSections !== null && f.lateSections !== 0) {
    const x = ev.xray?.lateSections;

    if (ev.lateFrom === "x-ray" && x) {
      const [example] = x;

      out.push({
        signal: "late",
        text: `${f.lateSections} section${f.lateSections > 1 ? "s first appear" : " first appears"} after the first chamber passed it${example ? `, e.g. Sec. ${example.num} "${example.heading}"` : ""}`,
        url: [example?.url, ev.newest?.xmlUrl].find(isLink) ?? congressGovUrl(s.id),
      });
    } else {
      const { newest, before } = ev;

      if (!newest || !before) {
        throw new Error(`${s.id}: late sections from a text diff need its newest and before-floor texts`);
      }

      const [sample = ""] = ev.newSectionSamples;

      out.push({
        signal: "late",
        text: `${f.lateSections} section${f.lateSections > 1 ? "s" : ""} in the ${newest.name} text have headings not in the ${before.name} text, the last before the first floor vote${sample === "" ? "" : `, e.g. Sec. ${sample}`}`,
        url: newest.xmlUrl,
      });
    }
  }

  if (f.lobbyingFilings !== null && f.lobbyingFilings !== 0) {
    out.push({
      signal: "lobbying",
      text:
        ev.lobbyingFrom === "x-ray"
          ? `${num(f.lobbyingFilings)} lobbying filing${f.lobbyingFilings === 1 ? "" : "s"} name${f.lobbyingFilings === 1 ? "s" : ""} it${ev.lobbyingClients === null ? "" : ` (${num(ev.lobbyingClients)} client${ev.lobbyingClients === 1 ? "" : "s"})`}`
          : `${num(f.lobbyingFilings)} lobbying filing${f.lobbyingFilings === 1 ? "" : "s"} cite${f.lobbyingFilings === 1 ? "s" : ""} its number (read ${num(ev.lobbyingChecked?.checked ?? 0)} of ${num(ev.lobbyingChecked?.searched ?? 0)} search hits${ev.lobbyingChecked && ev.lobbyingChecked.checked < ev.lobbyingChecked.searched ? `, so at least ${num(f.lobbyingFilings)}` : ""}; the x-ray also matches names)`,
      url: ev.lobbyingUrls.at(-1) ?? congressGovUrl(s.id),
    });
  }

  const clock = ev.clock;

  if (clock && clock.days <= 14 && ev.firstVote) {
    out.push({
      signal: "rushed",
      text: `Floor vote on ${fmtDate(clock.voteOn)}, ${clock.days === 0 ? "the same day as" : `${clock.days} day${clock.days === 1 ? "" : "s"} after`} ${clock.from === "introduced" ? "the bill was introduced" : `substitute amendment ${amendmentDisplay(clock.from)} was submitted`}`,
      url: ev.firstVote.url,
    });
  }

  if (f.closedRule) {
    out.push({
      signal: "rushed",
      text: "Brought to the House floor under a closed rule (no amendments allowed)",
      url: `${congressGovUrl(s.id)}/all-actions`,
    });
  }

  if (f.closestVote && c.sub.divisive !== null && c.sub.divisive >= 0.8) {
    out.push({
      signal: "divisive",
      text: `Close vote: ${f.closestVote.yeas}-${f.closestVote.nays}${isLink(ev.closestVoteOn) ? ` (${ev.closestVoteOn})` : ""}`,
      url: ev.closestVoteUrl ?? congressGovUrl(s.id),
    });
  }

  if (f.words !== null && f.words >= 20_000) {
    out.push({
      signal: "size",
      text: `${f.wordsCounted ? "" : "about "}${num(f.words)} words in the ${ev.newest?.name ?? "newest"} text`,
      url: ev.newest?.xmlUrl ?? congressGovUrl(s.id),
    });
  }

  return out;
}

function sectionLine(b: NonNullable<NonNullable<Candidate["evidence"]["xray"]>["buried"]>[number]): string {
  const bits = [
    b.dollarsMusd === null ? null : money(b.dollarsMusd),
    b.attentionPct === null ? null : `${Math.round(b.attentionPct * 100)}% of news`,
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
    const p = partyOf(c);
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
    cutoff: { score: FLAG_CUTOFF, max: isSweep(r.sweep) ? null : MAX_FLAGGED },
    belowCutoff: r.candidates.length - flagged.length,
    highestBelow: best && { display: billDisplay(best.status.id), score: best.score },
    movedBills: moved,
    ruleRiders: withRiders(r.candidates).map((c) => ({
      bill: c.status.id,
      display: billDisplay(c.status.id),
      title: c.status.title,
      outcome: ruleOutcome(c),
      riders: c.evidence.riders ?? [],
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
    .toSorted(([a], [b]) => a.localeCompare(b))
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
    case "pending": {
      return "deploy not finished";
    }

    case "deployed": {
      return `deployed to ${d.url}`;
    }

    case "unchanged": {
      return "live site already matches, not redeployed";
    }

    case "disabled": {
      return "not deployed (turned off)";
    }

    case "failed": {
      return `deploy failed (${d.error}), the previous live site is unchanged`;
    }

    default: {
      const unknown: never = d;

      return unknown;
    }
  }
};

const siteLine = ({ published, deploy }: Digest["site"]) =>
  `Site: ${published.length ? `published ${published.map((b) => billDisplay(b)).join(", ")}` : "no new bundles published"} · ${deployText(deploy)}`;

const cell = (v: number | null) => (v === null ? "—" : v.toFixed(2));

export function digestMarkdown(d: Digest): string {
  const L: string[] = [];

  if (isSweep(d.sweep)) {
    L.push(
      `# antibody sweep · ${d.sweep}th Congress · ${d.date}`,
      "",
      `Every bill of the ${d.sweep}th Congress scored on its whole record since ${d.since} · ${d.moved} bills had floor or committee action · rules ${d.rules.version}`,
    );
  } else {
    L.push(
      `# antibody watch · ${d.date}`,
      "",
      `Window: records updated ${d.since} → ${d.date}, actions dated from ${d.actionsSince} · ${d.moved} bills moved with new events (${d.alreadyReported} more were in an earlier digest) · rules ${d.rules.version}`,
    );
  }

  if (d.xrayed.length) {
    L.push(`X-rayed: ${d.xrayed.map((b) => billDisplay(b)).join(", ")}`);
  }

  L.push(siteLine(d.site));

  if (d.problems.length) {
    L.push("", `**${d.problems.length} problem${d.problems.length > 1 ? "s" : ""}** (see the end)`);
  }

  if (!d.flagged.length) {
    L.push(
      "",
      d.moved
        ? `Nothing reached the cutoff of ${d.cutoff.score}.${d.highestBelow ? ` Highest: ${d.highestBelow.display} at ${d.highestBelow.score}.` : ""}`
        : "Nothing new moved in this window.",
    );
  }

  for (const b of d.flagged.slice(0, DETAILED)) {
    L.push("", `## ${b.rank}. ${b.display} · ${b.shortTitle ?? b.title}`, "");
    const sponsor = b.sponsor ? b.sponsor.name : "no sponsor listed";
    L.push(`Score **${b.score}** · ${sponsor}${isLink(b.policyArea) ? ` · ${b.policyArea}` : ""}`, "");

    for (const r of b.reasons) {
      L.push(`- ${r.text} ([source](${r.url}))`);
    }

    L.push("", `Sub-scores: ${SIGNALS.map((k) => `${k} ${cell(b.subScores[k])}`).join(" · ")}`);

    if (b.xray) {
      L.push(
        b.xray.ok
          ? `X-ray: done in ${b.xray.seconds}s${b.xray.headlineHits === null ? "" : ` · ${b.xray.headlineHits} news articles on the bill as a whole`}${isLink(b.xray.bundle) ? ` · bundle ${b.xray.bundle}` : " · no bundle yet"}`
          : `X-ray: failed (${b.xray.error}) · log ${b.xray.log}`,
      );
    }

    const l = b.links;
    L.push(
      "",
      [
        isLink(l.page) ? `[page](${l.page})` : "page: not published yet",
        `[congress.gov](${l.congress})`,
        `[actions](${l.actions})`,
        isLink(l.text) ? `[newest text](${l.text})` : null,
        `[BILLSTATUS](${l.billstatus})`,
      ]
        .filter(Boolean)
        .join(" · "),
    );
  }

  const rest = d.flagged.slice(DETAILED);

  if (rest.length) {
    L.push(
      "",
      "## Also moving",
      "",
      `| # | bill | score | ${SIGNALS.join(" | ")} | why |`,
      `|---|---|---|${SIGNALS.map(() => "---").join("|")}|---|`,
    );

    for (const b of rest) {
      L.push(
        `| ${b.rank} | [${b.display}](${b.links.congress}) ${(b.shortTitle ?? b.title).slice(0, 60)} | ${b.score} | ${SIGNALS.map((k) => cell(b.subScores[k])).join(" | ")} | ${b.reasons[0]?.text ?? ""} |`,
      );
    }
  }

  if (d.ruleRiders.length) {
    L.push(
      "",
      "## Riders in House rules",
      "",
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

      for (const x of r.riders) {
        L.push(`- **${x.label}** (Sec. ${x.section}): "${x.quote}"`);
      }
    }
  }

  L.push(
    "",
    "## How bills are ranked",
    "",
    `Score = 100 × Σ weight × sub-score; an unmeasured sub-score (—) counts as 0. A bill is flagged at ${d.cutoff.score} or more${d.cutoff.max === null ? "" : ` (at most ${d.cutoff.max})`}; ${d.belowCutoff} of ${d.moved} moved bills scored below. The sponsor's party is never an input.`,
    "",
    auditLine(d.partyAudit, d),
    "",
  );

  for (const k of SIGNALS) {
    L.push(`- **${k}** (${Math.round(d.rules.weights[k] * 100)}%): ${d.rules.text[k]}`);
  }

  L.push("", "## Sources", "");

  for (const s of d.sources) {
    L.push(`- ${s.ok ? "ok" : "FAILED"} · [${s.name}](${s.url}) · ${s.ok ? `${s.items} in window` : s.error}`);
  }

  if (d.problems.length) {
    L.push("", "## Problems", "");

    for (const p of d.problems) {
      L.push(`- ${p}`);
    }
  }

  return `${L.join("\n")}\n`;
}
