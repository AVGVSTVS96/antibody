import { parseBillId } from "@antibody/core";
import { readRows } from "@antibody/core/node";
import { z } from "zod";

const [bill, n = "30", seed = "1", level] = Bun.argv.slice(2);

if (bill === undefined) {
  throw new Error("usage: sample.ts <bill> [n] [seed] [high|medium|low|topic]");
}

const id = parseBillId(bill);
let s = Number(seed);

const rand = () => {
  s = (s * 1_103_515_245 + 12_345) % 2 ** 31;

  return s / 2 ** 31;
};

const rows =
  level === "topic"
    ? (await readRows("lda_topic_refs", id)).map((r) => ({
        ...r,
        match: "topic",
        matched: r.topic,
        why: z.string().parse(r.evidence.reason),
      }))
    : (await readRows("lda_bill_refs", id)).filter((r) =>
        level !== undefined && level !== "" ? r.match === level : r.match !== "low",
      );

const pool = [...rows];

for (let i = pool.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  const a = pool[i];
  const b = pool[j];

  if (a !== undefined && b !== undefined) {
    [pool[i], pool[j]] = [b, a];
  }
}

for (const r of pool.slice(0, Number(n))) {
  const hits = [...r.quote.matchAll(new RegExp(r.matched.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "gu"))];
  const exact = hits.find((h) => !/\d/u.test(r.quote[h.index + r.matched.length] ?? "")) ?? hits[0];
  const at = Math.max(0, (exact?.index ?? 0) - 160);
  console.log(
    `${r.match} | ${r.matched} | ${r.why}\n  ${r.source_url}\n  …${r.quote.slice(at, at + 380).replaceAll(/\s+/gu, " ")}…\n`,
  );
}
