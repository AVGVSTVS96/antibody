/**
 * Draws a fresh, stratified, seeded sample of resolver outcomes for hand-checking, leaving out every name the
 * Phase 0 sample already checked. Prints PSV: stratum|source|name|context|edgar name|ticker|method|confidence|reason
 *   bun packages/resolve/scripts/sample.ts > packages/resolve/eval/sample.psv
 */
import { join } from "node:path";
import { paths, ROOT } from "@antibody/core/node";
import { loadEdgar } from "../src/edgar.ts";
import type { Resolved } from "../src/resolve.ts";

const PER = {
  ticker: 15,
  name_exact: 20,
  fuzzy: 10,
  llm_same: 20,
  llm_subsidiary: 20,
  llm_parent: 20,
  none: 15,
  rejected: 15,
};

const old = new Set(
  (await Bun.file(join(ROOT, "spikes/entities/eval_labeled.psv")).text())
    .split("\n")
    .map((l) => l.split("|")[2]?.toUpperCase()),
);
const outcomes = (await Bun.file(
  join(paths.raw("entities"), "resolve", "dev-outcomes.json"),
).json()) as Resolved["outcomes"];
const edgar = new Map((await loadEdgar()).map((c) => [c.cik, c]));

const hash = (s: string) => Number(new Bun.CryptoHasher("sha1").update(`antibody-p1:${s}`).digest("hex").slice(0, 8));
const strata = new Map<string, Resolved["outcomes"]>();
for (const o of outcomes) {
  if (old.has(o.mention.name.toUpperCase())) continue;
  const k = o.match?.method ?? o.outcome.kind;
  if (!(k in PER)) continue;
  strata.set(k, [...(strata.get(k) ?? []), o]);
}
const clean = (s: unknown) =>
  String(s ?? "")
    .replace(/[|\n]/g, " ")
    .slice(0, 160);
for (const [k, n] of Object.entries(PER)) {
  const pick = (strata.get(k) ?? []).sort((a, b) => hash(a.mention.src) - hash(b.mention.src)).slice(0, n);
  for (const o of pick) {
    const c = o.match ? edgar.get(o.match.cik) : undefined;
    const e = (o.match?.evidence ?? {}) as Record<string, unknown>;
    const why = o.outcome.kind === "rejected" || o.outcome.kind === "none" ? o.outcome.why : e.reason;
    console.log(
      [
        k,
        o.mention.source,
        o.mention.name,
        o.mention.context,
        c?.name,
        c?.tickers[0],
        o.match?.method,
        o.match?.confidence,
        why,
      ]
        .map(clean)
        .join("|"),
    );
  }
}
