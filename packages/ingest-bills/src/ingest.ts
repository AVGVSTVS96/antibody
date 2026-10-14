import { type BillId, billRef, billstatusUrl, congressGovUrl, type Row, type TableName } from "@antibody/core";
import { writeRows } from "@antibody/core/node";
import {
  amendmentId,
  amendmentLabel,
  amendmentStatus,
  amendmentUrl,
  attribute,
  lastActionDate,
  loadText,
  rollId,
  versionStep,
} from "./amendments.ts";
import { type BillStatus, parseBillStatus } from "./billstatus.ts";
import { type CounterpartStep, canRun, counterparts } from "./counterparts.ts";
import type { AmendmentText } from "./crec.ts";
import { cached, NotFound } from "./fetch.ts";
import { isLate, type Lineage, type ParsedVersion, PURE_SPLIT, trace } from "./lineage.ts";
import { findPredecessor } from "./predecessor.ts";
import { PartialAmendment, parseSections, type Sec, sectionNum } from "./sections.ts";
import { textVersions, type VersionRef } from "./versions.ts";

export interface IngestOptions {
  refresh?: boolean;
  /** Run the LLM counterpart pass (needs the `claude` CLI). */
  llm?: boolean;
  log?: (m: string) => void;
  /** Write rows to data/out (off in tests). */
  write?: boolean;
}

interface Version extends ParsedVersion {
  ref: VersionRef;
  predecessorRule: string | null;
}

export type BillRows = { [T in TableName]?: Row<T>[] };

const locator = (path: string) =>
  path
    .split("/")
    .map((p) => p.replace(":", " ").replace(/^sec /, "sec. "))
    .join(", ");

/** The last heading that isn't in all caps (enrolled bills and laws print some headings in caps). */
const heading = (l: Lineage) =>
  Object.values(l.history)
    .map((s) => s.heading)
    .reverse()
    .find((h) => h !== h.toUpperCase()) ?? l.last.heading;

export async function loadStatus(bill: BillId, refresh = false): Promise<BillStatus> {
  const { congress, type, number } = billRef(bill);
  return parseBillStatus(
    await cached(billstatusUrl(bill), `BILLSTATUS-${congress}${type}${number}.xml`, refresh),
    bill,
  );
}

const loadSections = async (ref: VersionRef): Promise<Sec[]> => parseSections(await cached(ref.url, ref.file));

/** Every text version, its sections and their lineage, the sponsors, committees and amendments of one bill, as rows. */
export async function ingestBill(bill: BillId, opts: IngestOptions = {}) {
  const log = opts.log ?? (() => {});
  const status = await loadStatus(bill, opts.refresh);
  const skipped: { code: string; why: string }[] = [];
  const own: Version[] = [];
  for (const ref of textVersions(status)) {
    try {
      own.push({ ref, code: ref.code, secs: await loadSections(ref), predecessor: false, predecessorRule: null });
    } catch (e) {
      if (!(e instanceof PartialAmendment || e instanceof NotFound)) throw e;
      skipped.push({ code: ref.code, why: (e as Error).message });
      log(`skipped ${ref.code}: ${(e as Error).message}`);
    }
  }
  const head = own[0];
  const pred = head ? await findPredecessor(status, head, loadSections, opts.refresh ?? false) : null;
  const versions: Version[] = pred
    ? [
        {
          ref: pred.version,
          code: pred.version.code,
          secs: await loadSections(pred.version),
          predecessor: true,
          predecessorRule: pred.rule,
        },
        ...own,
      ]
    : own;
  log(`${versions.length} versions: ${versions.map((v) => `${v.code} (${v.secs.length})`).join(", ")}`);

  const { lineages, steps } = trace(bill, versions);
  const byCode = new Map(versions.map((v) => [v.code, v]));
  const late = new Map(lineages.map((l) => [l.id, isLate(l, versions)]));
  log(`${lineages.length} section lineages, ${[...late.values()].filter(Boolean).length} late`);

  const rows: BillRows = {};
  const src = billstatusUrl(bill);
  const { congress, type, number } = billRef(bill);

  rows.bills = [
    {
      id: bill,
      congress,
      type,
      number,
      title: status.title,
      short_title: status.shortTitle,
      sponsor_bioguide: status.sponsor,
      introduced_on: status.introducedOn,
      policy_area: status.policyArea,
      law: status.law,
      law_on: status.lawOn,
      latest_action: status.latestAction?.text ?? null,
      url: congressGovUrl(bill),
      source_url: src,
      source_locator: null,
    },
  ];

  rows.versions = versions.map((v) => ({
    id: `${bill}@${v.code}`,
    bill_id: bill,
    code: v.code,
    name: v.ref.name,
    date: v.ref.date,
    url: v.ref.url,
    sections: v.secs.length,
    words: v.secs.reduce((n, s) => n + s.words, 0),
    predecessor_rule: v.predecessorRule,
    source_url: v.ref.url,
    source_locator: null,
  }));

  const final = versions.at(-1)?.code;
  rows.sections = lineages.map((l) => {
    const firstPath = l.history[l.firstVersion]!.path;
    return {
      id: l.id,
      bill_id: bill,
      num: sectionNum(l.last.path),
      heading: heading(l),
      path: l.last.path,
      first_version: l.firstVersion,
      in_final: l.lastVersion === final,
      changed_in: l.changedIn,
      removed_in: l.removedIn,
      revived_in: l.revivedIn,
      split_from: l.splitFrom?.id ?? null,
      split_into: l.splitInto,
      merged_into: l.mergedInto?.id ?? null,
      late: late.get(l.id)!,
      words: l.last.words,
      text_url: byCode.get(l.lastVersion)!.ref.url,
      preview: l.last.text.slice(0, 200),
      history: l.history,
      source_url: byCode.get(l.firstVersion)!.ref.url,
      source_locator: locator(firstPath),
    };
  });

  rows.sponsorships = [
    ...(status.sponsor
      ? [{ bioguide: status.sponsor, role: "sponsor" as const, date: status.introducedOn, withdrawnOn: null }]
      : []),
    ...status.cosponsors.filter((c) => c.bioguide).map((c) => ({ ...c, role: "cosponsor" as const })),
  ].map((s) => ({
    id: `${bill}:${s.bioguide}`,
    bill_id: bill,
    bioguide: s.bioguide,
    role: s.role,
    date: s.date,
    withdrawn_on: s.withdrawnOn,
    source_url: src,
    source_locator: s.role === "sponsor" ? "sponsors" : "cosponsors",
  }));

  const committees = new Map(status.committees.filter((c) => c.code).map((c) => [c.code, c]));
  rows.bill_committees = [...committees.values()].map((c) => ({
    id: `${bill}:${c.code}`,
    bill_id: bill,
    committee_id: c.code,
    activity: [...new Set(c.activities.map((a) => a.name).filter((n) => n && n !== "Unknown"))].join(", ") || null,
    source_url: src,
    source_locator: `committees: ${c.name}`,
  }));

  const ownDated = own.map((v) => ({ code: v.code, date: v.ref.date }));
  const amendments = status.amendments.map((a) => {
    const st = amendmentStatus(a);
    const when = lastActionDate(a);
    return { rec: a, status: st, when, step: st === "no_action" ? null : versionStep(when, ownDated) };
  });
  rows.amendments = amendments.map(({ rec, status: st, step }) => ({
    id: amendmentId(rec),
    bill_id: bill,
    number: amendmentLabel(rec),
    chamber: rec.chamber,
    sponsor_bioguide: rec.sponsorBioguide,
    sponsor_committee: rec.sponsorCommittee,
    purpose: rec.purpose,
    status: st,
    latest_action: rec.latestAction?.text ?? null,
    latest_action_on: rec.latestAction?.date || null,
    roll_id: rollId(rec),
    version_step: step,
    url: amendmentUrl(rec),
    source_url: src,
    source_locator: `amendments: ${amendmentLabel(rec)}`,
  }));

  const texts = new Map<string, AmendmentText | null>();
  const textOf = async (rec: (typeof amendments)[number]["rec"]) => {
    const key = `${rec.type} ${rec.number}`;
    if (!texts.has(key)) texts.set(key, await loadText(rec));
    return texts.get(key)!;
  };
  rows.amendment_sections = [];
  const counterpartSteps: CounterpartStep[] = [];
  for (const s of steps) {
    const from = byCode.get(s.from)!;
    const to = byCode.get(s.to)!;
    if (from.predecessor) continue;
    const added = lineages.filter((l) => l.firstVersion === s.to && !(l.splitFrom && l.splitFrom.share >= PURE_SPLIT));
    const removed = lineages.filter((l) => l.history[s.from] && l.removedIn === s.to);
    counterpartSteps.push({
      from: s.from,
      to: s.to,
      fromName: from.ref.name,
      toName: to.ref.name,
      removed: removed.filter((l) => !l.splitInto.length && !l.mergedInto),
      added: added.filter((l) => !l.splitFrom),
    });
    const agreed = amendments.filter((a) => a.status === "agreed" && a.step === `${s.from}->${s.to}`);
    if (!agreed.length || (!added.length && !removed.length)) continue;
    const withText = await Promise.all(
      agreed.map(async (a) => ({ rec: a.rec, when: a.when, text: await textOf(a.rec) })),
    );
    const amended = new Map<string, AmendmentText | null>();
    for (const a of agreed) {
      if (!a.rec.amends) continue;
      const parent = status.amendments.find((x) => `${x.type} ${x.number}` === a.rec.amends);
      if (parent) amended.set(a.rec.amends, await textOf(parent));
    }
    rows.amendment_sections.push(
      ...attribute({ bill, from: s.from, to: s.to, agreed: withText, added, removed, amended }),
    );
  }
  log(`${rows.amendments.length} amendments, ${rows.amendment_sections.length} section attributions`);

  rows.counterparts = opts.llm && canRun() ? await counterparts(bill, counterpartSteps, log) : [];

  if (opts.write ?? true)
    for (const [table, list] of Object.entries(rows)) await writeRows(table as TableName, bill, list as never[]);
  return { status, versions, lineages, steps, rows, skipped };
}
