import { join } from "node:path";
import { type BillId, parseBillId } from "@antibody/core";
import { paths, readRows } from "@antibody/core/node";
import { OUTLETS, sideOf } from "@antibody/ingest-news";
import { MIN_TEXT_CHARS } from "../src/attention.ts";

const groupOf = new Map(OUTLETS.map((o) => [o.domain, o.group]));
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : "-");
const mean = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : "-");

const members = await readRows("members").catch(() => []);
const party = new Map(members.map((m) => [m.id.replace(/^member:/, ""), m.party]));

for (const arg of Bun.argv.slice(2)) {
  const bill = parseBillId(arg) as BillId;
  const [b] = await readRows("bills", bill);
  const sections = await readRows("sections", bill);
  const articles = await readRows("articles", bill);
  const scores = await readRows("section_scores", bill);
  const file = Bun.file(
    join(paths.raw("analyze"), "match", `${bill}.${process.env.ANTIBODY_MATCH_MODEL ?? "sonnet"}.json`),
  );
  const matches: Record<string, { about: string; sections: string[]; whole: boolean }> = (await file.exists())
    ? (await file.json()).matches
    : {};
  console.log(
    `\n## ${bill} ${b?.short_title ?? ""} (sponsor ${b?.sponsor_bioguide ?? "?"}, party ${party.get(b?.sponsor_bioguide ?? "") ?? "?"})`,
  );

  console.log("\nmatcher by side (articles read):");
  for (const side of ["left", "center", "right"] as const) {
    const read = articles.filter(
      (a) =>
        (a.text_chars ?? 0) >= MIN_TEXT_CHARS &&
        a.outlet_id &&
        sideOf(groupOf.get(a.outlet_id)!) === side &&
        matches[a.id],
    );
    const rel = read.filter((a) => matches[a.id]!.about !== "unrelated");
    const main = read.filter((a) => matches[a.id]!.about === "bill");
    console.log(
      `  ${side.padEnd(6)} read ${String(read.length).padStart(3)}  about-bill ${pct(main.length, read.length).padStart(4)}  sections/article ${mean(rel.map((a) => matches[a.id]!.sections.length))}  whole ${pct(rel.filter((a) => matches[a.id]!.whole).length, rel.length)}`,
    );
  }

  const final = scores.length;
  const count = (l: string) => scores.filter((s) => s.label === l).length;
  const late = scores.filter((s) => s.late);
  console.log(
    `\nlabels over ${final} final sections: headline ${pct(count("headline"), final)}, buried ${pct(count("buried"), final)}, normal ${pct(count("normal"), final)}`,
  );
  console.log(
    `late sections: ${late.length} (${pct(late.length, final)}); of them buried ${pct(late.filter((s) => s.label === "buried").length, late.length)}`,
  );
  const withAtt = scores.filter((s) => s.attention_pct !== null);
  console.log(
    `median attention pct ${mean(
      withAtt
        .map((s) => s.attention_pct!)
        .sort((a, b) => a - b)
        .slice(Math.floor(withAtt.length / 2), Math.floor(withAtt.length / 2) + 1),
    )}; sections with dollars ${pct(scores.filter((s) => s.dollars_musd !== null).length, final)}; with lobbying ${pct(scores.filter((s) => s.lobbying_reports > 0).length, final)}`,
  );
  console.log(`sections total ${sections.length}`);
}
