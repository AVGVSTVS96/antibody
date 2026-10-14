import { type BillId, billDisplay, billstatusUrl, congressGovUrl } from "@antibody/core";
import { STEPS } from "./events.ts";
import { RULE_TEXT, RULES_VERSION, type Signal, WEIGHTS } from "./score.ts";
import type { Candidate, WatchResult } from "./watch.ts";

export interface Reason {
  signal: Signal;
  text: string;
  url: string;
}

export const FLAGGED = 15;
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

/** Why the bill was flagged, one line per signal that fired, each with its source. Same templates for every bill. */
export function reasons(c: Candidate): Reason[] {
  const { facts: f, evidence: ev, status: s } = c;
  const out: Reason[] = [];
  const top = c.events.find((e) => e.step === f.step && c.fresh.has(e.id))!;
  out.push({
    signal: "moving",
    text: `${STEPS[f.step].label[0]!.toUpperCase()}${STEPS[f.step].label.slice(1)} on ${fmtDate(top.date)}${top.tally ? ` (${top.tally.yeas}-${top.tally.nays})` : ""}`,
    url: top.url,
  });
  if (f.deficitMusd !== null && ev.xray?.deficit)
    out.push({
      signal: "dollars",
      text: `CBO: ${money(f.deficitMusd)} to the deficit over ${ev.xray.deficit.period} (baseline: ${ev.xray.deficit.baselineLabel})`,
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
            text: `${f.lateSections} section${f.lateSections > 1 ? "s" : ""} first appear after the first chamber passed it${x[0] ? `, e.g. Sec. ${x[0].num} "${x[0].heading}"` : ""}`,
            url: x[0]?.url || ev.newest?.xmlUrl || congressGovUrl(s.id),
          }
        : {
            signal: "late",
            text: `${f.lateSections} section${f.lateSections > 1 ? "s" : ""} in the ${ev.newest!.name} text have headings not in the ${ev.passed!.name} text the first chamber passed${ev.newSectionSamples[0] ? `, e.g. Sec. ${ev.newSectionSamples[0]}` : ""}`,
            url: ev.newest!.xmlUrl,
          },
    );
  }
  if (f.lobbyingFilings)
    out.push({
      signal: "lobbying",
      text:
        ev.lobbyingFrom === "x-ray"
          ? `${num(f.lobbyingFilings)} lobbying filings name it${ev.lobbyingClients !== null ? ` (${num(ev.lobbyingClients)} clients)` : ""}`
          : `${num(f.lobbyingFilings)} lobbying filings mention its number or short title (search count, before the x-ray checks each one)`,
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
      text: `Close vote: ${f.closestVote.yeas}-${f.closestVote.nays}`,
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
    b.lobbyingReports ? `${b.lobbyingReports} lobbying reports` : null,
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

/** The bill's page on the site, when ANTIBODY_PAGE_URL (e.g. `https://…/bill/{id}`) is set and its bundle is published. */
export const pageUrl = (id: BillId, published = true) => {
  const template = process.env.ANTIBODY_PAGE_URL;
  return template && published ? template.replace("{id}", id) : null;
};

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

export function digestJson(r: WatchResult) {
  const flagged = r.candidates.slice(0, FLAGGED);
  const parties: Record<string, number> = {};
  for (const c of flagged) {
    const p = c.status.sponsor?.party || "unknown";
    parties[p] = (parties[p] ?? 0) + 1;
  }
  return {
    schema: 1,
    date: r.date,
    since: r.since,
    actionsSince: r.actionsSince,
    generatedAt: r.generatedAt,
    rules: { version: RULES_VERSION, weights: WEIGHTS, text: RULE_TEXT },
    moved: r.candidates.length,
    alreadyReported: r.alreadyReported,
    xrayed: r.xrayed,
    flaggedBySponsorParty: parties,
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
      events: c.events
        .slice(0, 8)
        .map(({ id, kind, step, date, text, url, tally }) => ({
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

const cell = (v: number | null) => (v === null ? "—" : v.toFixed(2));

export function digestMarkdown(d: Digest): string {
  const L: string[] = [];
  L.push(`# antibody watch · ${d.date}`, "");
  L.push(
    `Window: records updated ${d.since} → ${d.date}, actions dated from ${d.actionsSince} · ${d.moved} bills moved with new events (${d.alreadyReported} more were in an earlier digest) · rules ${d.rules.version}`,
  );
  if (d.xrayed.length) L.push(`X-rayed: ${d.xrayed.map((b) => billDisplay(b as BillId)).join(", ")}`);
  if (d.problems.length)
    L.push("", `**${d.problems.length} problem${d.problems.length > 1 ? "s" : ""}** (see the end)`);
  if (!d.flagged.length) L.push("", "Nothing new moved in this window.");

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

  L.push("", "## How bills are ranked", "");
  L.push(
    `Score = 100 × Σ weight × sub-score; an unmeasured sub-score (—) counts as 0. The sponsor's party is never an input. Flagged by sponsor party, for the symmetry audit: ${
      Object.entries(d.flaggedBySponsorParty)
        .map(([p, n]) => `${p} ${n}`)
        .join(" · ") || "none"
    }.`,
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
