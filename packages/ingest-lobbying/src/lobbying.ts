import { join } from "node:path";
import type { BillId, Row, StageContext } from "@antibody/core";
import { readRows, writeRows } from "@antibody/core/node";
import { buildAliases, coCited, sameTitle } from "./aliases.ts";
import { billStatus } from "./billstatus.ts";
import { type Aliases, matcher } from "./extract.ts";
import { pull, rawDir } from "./pull.ts";
import { extract, markSuperseded, mergeClient } from "./rows.ts";
import { upsert } from "./shards.ts";
import { spendRows } from "./spend.ts";
import { namedMembers } from "./staff.ts";

/** Aliases, then a pull; numbers that filings cite next to the bill's name are confirmed and pulled too. */
export async function resolveAliases(bill: BillId, ctx: Pick<StageContext, "refresh" | "signal" | "log">) {
  let aliases = await buildAliases(bill, [], ctx.signal);
  let filings = await pull(aliases, ctx);
  const confirmed: BillId[] = [];
  for (const id of coCited(filings, matcher(aliases))) {
    const s = await billStatus(id, ctx.signal);
    if (s && sameTitle(aliases, s)) confirmed.push(id);
  }
  if (confirmed.length) {
    ctx.log(`same short title: ${confirmed.join(", ")}`);
    aliases = await buildAliases(bill, confirmed, ctx.signal);
    filings = await pull(aliases, ctx);
  }
  await Bun.write(join(rawDir(bill), "aliases.json"), JSON.stringify(aliases, null, 1));
  return { aliases, filings };
}

export async function readAliases(bill: BillId): Promise<Aliases | null> {
  const file = Bun.file(join(rawDir(bill), "aliases.json"));
  return (await file.exists()) ? file.json() : null;
}

const yearOf = (uuid: string, filings: Map<string, Row<"lda_filings">>) => String(filings.get(uuid)!.year);

export async function runLobbying(ctx: StageContext) {
  const bill = ctx.bill!;
  const { aliases, filings } = await resolveAliases(bill, ctx);
  const known = new Set((await readRows("sections", bill)).map((s) => s.num));
  const x = extract(bill, filings, matcher(aliases), known);
  const byId = new Map(x.filings.map((f) => [f.id, f]));
  const years = aliases.years.map(String);

  await upsert("lda_filings", x.filings, (f) => String(f.year), { finish: markSuperseded });
  await upsert("lda_lobbyists", x.lobbyists, (l) => yearOf(l.filing_id, byId), {
    alsoShards: years,
    prepare: (rows) =>
      rows
        .map((r) => ({
          ...r,
          named_members: r.covered_position ? namedMembers(r.covered_position) : [],
          bill_ids: r.bill_ids.filter((b) => b !== bill),
        }))
        .filter((r) => r.bill_ids.length),
    merge: (old, next) => ({ ...next, bill_ids: [...new Set([...old.bill_ids, ...next.bill_ids])].sort() }),
  });
  await upsert("lda_clients", x.clients, () => "all", { merge: mergeClient });
  await writeRows("lda_bill_refs", bill, x.refs);

  const stored = new Map<string, Row<"lda_filings">>();
  for (const y of new Set(x.filings.map((f) => String(f.year))))
    for (const f of await readRows("lda_filings", y)) if (byId.has(f.id)) stored.set(f.id, f);
  const counted = x.refs.filter((r) => r.match !== "low");
  const spend = spendRows(bill, stored, counted);
  await writeRows("lda_spend", bill, spend);

  const whole = spend.find((s) => s.client_key === null);
  const level = (l: string) => x.refs.filter((r) => r.match === l).length;
  ctx.log(
    `${x.filings.length} filings name it (lines: ${level("high")} high, ${level("medium")} medium, ${level("low")} low); ` +
      `${whole?.reports ?? 0} LD-2 reports, ${spend.length - 1} clients, ` +
      `$${Math.round((whole?.total_usd ?? 0) / 1e6)}M total, $${Math.round((whole?.share_usd ?? 0) / 1e6)}M share estimate`,
  );
}
