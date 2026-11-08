import { join } from "node:path";
import { loadEdgar } from "../src/edgar.ts";
import type { Resolved } from "../src/resolve.ts";
import { loadOutcomes } from "./outcomes.ts";

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
  (await Bun.file(join(import.meta.dir, "../eval/phase0-labeled.psv")).text())
    .split("\n")
    .map((l) => l.split("|")[2]?.toUpperCase()),
);

const outcomes = await loadOutcomes();

const edgar = new Map((await loadEdgar()).map((c) => [c.cik, c]));

const hash = (s: string) =>
  Number.parseInt(new Bun.CryptoHasher("sha1").update(`antibody-p1:${s}`).digest("hex").slice(0, 8), 16);

const strata = new Map<string, Resolved["outcomes"]>();

for (const o of outcomes) {
  if (old.has(o.mention.name.toUpperCase())) {
    continue;
  }

  const k = o.match?.method ?? o.outcome.kind;

  if (!(k in PER)) {
    continue;
  }

  strata.set(k, [...(strata.get(k) ?? []), o]);
}

const clean = (s: string | number | null | undefined) =>
  String(s ?? "")
    .replaceAll(/[|\n]/gu, " ")
    .slice(0, 160);

for (const [k, n] of Object.entries(PER)) {
  const pick = (strata.get(k) ?? []).toSorted((a, b) => hash(a.mention.src) - hash(b.mention.src)).slice(0, n);

  for (const o of pick) {
    const c = o.match ? edgar.get(o.match.cik) : undefined;
    // SAFETY: review writes evidence.reason as the reviewer's reason string.
    const reason = (o.match?.evidence as { reason?: string } | undefined)?.reason;
    const why = o.outcome.kind === "rejected" || o.outcome.kind === "none" ? o.outcome.why : reason;

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
