import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { BillId } from "@antibody/core";
import { paths, ROOT, readRows } from "@antibody/core/node";

export interface XrayRun {
  ok: boolean;
  error: string | null;
  seconds: number;
  log: string;
}

/** Runs `antibody xray <bill>` in its own process (each stage caps its own heavy work), logging to a file. */
export async function runXray(bill: BillId, logDir: string, signal?: AbortSignal): Promise<XrayRun> {
  await mkdir(logDir, { recursive: true });
  const log = join(logDir, `${bill}.log`);
  const minutes = Number(process.env.ANTIBODY_WATCH_XRAY_MINUTES ?? 60);
  const t0 = performance.now();
  const proc = Bun.spawn(["bun", join(ROOT, "apps/cli/src/main.ts"), "xray", bill], {
    cwd: ROOT,
    stdout: Bun.file(log),
    stderr: "pipe",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(minutes * 60_000)])
      : AbortSignal.timeout(minutes * 60_000),
  });
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  const seconds = Math.round((performance.now() - t0) / 100) / 10;
  if (stderr) await Bun.write(`${log}.err`, stderr);
  if (code === 0) return { ok: true, error: null, seconds, log };
  const lastLine = stderr.trim().split("\n").filter(Boolean).pop() ?? `exit ${code ?? "killed"}`;
  return {
    ok: false,
    error: proc.signalCode ? `stopped after ${minutes} min (${proc.signalCode})` : lastLine,
    seconds,
    log,
  };
}

export interface Section {
  id: string;
  num: string;
  heading: string;
  url: string;
}

export interface BuriedSection extends Section {
  dollarsMusd: number | null;
  attentionPct: number | null;
  lobbyingFirms: number;
  /** Kinds of legal reach in its text (limits courts, overrides state law, …), from reach-v2. */
  reach: string[];
  late: boolean;
}

/** What the x-ray tables say about a bill, for whichever stages have written rows. */
export interface XrayFacts {
  lateSections: Section[] | null;
  finalSections: number | null;
  deficit: { musd: number; period: string; url: string; baselineLabel: string } | null;
  lobbying: { filings: number; clients: number | null } | null;
  buried: BuriedSection[] | null;
  headlineHits: number | null;
  bundle: string | null;
  published: boolean;
}

export async function xrayFacts(bill: BillId): Promise<XrayFacts> {
  const [sections, estimates, lines, refs, scores, attention] = await Promise.all([
    readRows("sections", bill),
    readRows("cbo_estimates", bill),
    readRows("cbo_lines", bill),
    readRows("lda_bill_refs", bill),
    readRows("section_scores", bill),
    readRows("attention", bill),
  ]);
  const byId = new Map(sections.map((s) => [s.id, s]));
  const section = (id: string): Section => {
    const s = byId.get(id);
    return { id, num: s?.num ?? id.split(":").pop() ?? id, heading: s?.heading ?? "", url: s?.text_url ?? "" };
  };

  const currentLaw = new Map(estimates.filter((e) => e.baseline === "current-law").map((e) => [e.id, e]));
  const latest = [...currentLaw.values()].sort((a, b) => (b.published_on ?? "").localeCompare(a.published_on ?? ""))[0];
  let deficit: XrayFacts["deficit"] = null;
  if (latest) {
    const own = lines.filter((l) => l.estimate_id === latest.id && l.measure === "deficit");
    const whole = own.filter((l) => l.line_kind === "whole-bill");
    const pick = whole.length ? whole : own.filter((l) => l.line_kind !== "whole-bill");
    if (pick.length) {
      const musd = whole.length
        ? whole.reduce((m, l) => (Math.abs(l.total_musd) > Math.abs(m) ? l.total_musd : m), 0)
        : pick.reduce((sum, l) => sum + l.total_musd, 0);
      deficit = { musd, period: pick[0]!.period, url: latest.url, baselineLabel: latest.baseline_label };
    }
  }

  const filingIds = new Set(refs.map((r) => r.filing_id));
  const filings = filingIds.size ? (await readRows("lda_filings")).filter((f) => filingIds.has(f.id)) : [];
  const clients = new Set(filings.map((f) => f.client_key));
  const general = attention.find((a) => a.section_id === null);

  return {
    lateSections: scores.length
      ? scores.filter((s) => s.late).map((s) => section(s.section_id))
      : sections.length
        ? sections.filter((s) => s.late && s.in_final).map((s) => section(s.id))
        : null,
    finalSections: sections.length ? sections.filter((s) => s.in_final).length : null,
    deficit,
    lobbying: refs.length ? { filings: filingIds.size, clients: filings.length ? clients.size : null } : null,
    buried: scores.length
      ? scores
          .filter((s) => s.label === "buried")
          .sort((a, b) => (b.buried ?? 0) - (a.buried ?? 0))
          .map((s) => ({
            ...section(s.section_id),
            dollarsMusd: s.dollars_musd,
            attentionPct: s.attention_pct,
            lobbyingFirms: s.lobbying_firms,
            reach: s.reach ?? [],
            late: s.late,
          }))
      : null,
    headlineHits: general?.hits ?? null,
    bundle: (await Bun.file(join(paths.bundles, `${bill}.json`)).exists()) ? join(paths.bundles, `${bill}.json`) : null,
    published: await Bun.file(join(paths.published, `${bill}.json`)).exists(),
  };
}
