import { parseBillId } from "@antibody/core";
import { readRows } from "@antibody/core/node";

/** `bun packages/ingest-lobbying/scripts/sample.ts <bill> <n> <seed> [high|medium|low|topic]`: lines to read by hand. */
const [bill, n = "30", seed = "1", level] = Bun.argv.slice(2);
const id = parseBillId(bill!);
let s = Number(seed);
const rand = () => {
  s = (s * 1103515245 + 12345) % 2 ** 31;
  return s / 2 ** 31;
};

const rows =
  level === "topic"
    ? (await readRows("lda_topic_refs", id)).map((r) => ({
        ...r,
        match: "topic",
        matched: r.topic,
        why: r.evidence.reason,
      }))
    : (await readRows("lda_bill_refs", id)).filter((r) => (level ? r.match === level : r.match !== "low"));
const pool = [...rows];
for (let i = pool.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [pool[i], pool[j]] = [pool[j]!, pool[i]!];
}
for (const r of pool.slice(0, Number(n))) {
  const hits = [...r.quote.matchAll(new RegExp(String(r.matched).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))];
  const exact = hits.find((h) => !/\d/.test(r.quote[h.index! + String(r.matched).length] ?? "")) ?? hits[0];
  const at = Math.max(0, (exact?.index ?? 0) - 160);
  console.log(
    `${r.match} | ${r.matched} | ${r.why}\n  ${r.source_url}\n  …${r.quote.slice(at, at + 380).replace(/\s+/g, " ")}…\n`,
  );
}
