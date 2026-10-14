#!/usr/bin/env bun
import { join } from "node:path";
import { billDisplay } from "@antibody/core";
import { paths } from "@antibody/core/node";
import { type BillStatus, parseBillStatus } from "./billstatus.ts";
import { reasons } from "./digest.ts";
import { type Candidate, candidate, enrich, rank } from "./watch.ts";

/**
 * Scores past weeks of real bills as if the watcher had run then: `bun packages/watch/src/backtest.ts`.
 * Checks the ranking on known fights from both parties with the same rules. Reads only; writes caches.
 */
const CASES = [
  { file: "BILLSTATUS-119hr1.xml", since: "2025-06-28", until: "2025-07-04", note: "OBBBA (R), final week" },
  { file: "BILLSTATUS-117hr5376.xml", since: "2022-08-05", until: "2022-08-16", note: "IRA (D), final week" },
  { file: "BILLSTATUS-119s1582.xml", since: "2025-06-10", until: "2025-06-17", note: "GENIUS (R), Senate week" },
  { file: "BILLSTATUS-119s1582.xml", since: "2025-07-14", until: "2025-07-18", note: "GENIUS (R), House week" },
];

/** The bill as BILLSTATUS would have shown it on `until`. */
function asOf(s: BillStatus, until: string): BillStatus {
  const actions = s.actions.filter((a) => a.date <= until);
  const presented = actions.some((a) => /^Presented to President/.test(a.text));
  return {
    ...s,
    actions,
    versions: s.versions.filter((v) => (v.date ? v.date <= until : presented)),
    cbo: s.cbo.filter((c) => c.publishedOn <= until),
    amendments: s.amendments.filter((a) => !a.submittedOn || a.submittedOn <= until),
    laws: actions.some((a) => a.type === "BecameLaw") ? s.laws : [],
  };
}

const rows: { note: string; c: Candidate; problems: string[] }[] = [];
for (const k of CASES) {
  const s = asOf(parseBillStatus(await Bun.file(join(paths.raw("bills"), "raw", k.file)).text()), k.until);
  const c = candidate(s, k.since);
  if (!c) {
    console.log(`${k.note}: nothing moved`);
    continue;
  }
  const problems = await enrich(c, join(paths.raw("watch"), "cache"));
  rows.push({ note: k.note, c, problems });
}
for (const { note, c, problems } of rank(rows.map((r) => r.c)).map((c) => rows.find((r) => r.c === c)!)) {
  console.log(`\n${billDisplay(c.status.id)} · ${note} · score ${c.score}`);
  console.log(
    `  ${Object.entries(c.sub)
      .map(([k, v]) => `${k} ${v ?? "—"}`)
      .join(" · ")}`,
  );
  for (const r of reasons(c)) console.log(`  - ${r.text}`);
  for (const p of problems) console.log(`  ! ${p}`);
}
