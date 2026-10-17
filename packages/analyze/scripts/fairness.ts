import { join } from "node:path";
import { type BillId, parseBillId } from "@antibody/core";
import { paths, readRows } from "@antibody/core/node";
import { OUTLETS, type Side, sideOf } from "@antibody/ingest-news";
import { MIN_TEXT_CHARS } from "../src/attention.ts";
import { SCORE, stakes } from "../src/score.ts";

const groupOf = new Map(OUTLETS.map((o) => [o.domain, o.group]));
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : "-");
const mean = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : "-");

const members = await readRows("members").catch(() => []);
const party = new Map(members.map((m) => [m.id.replace(/^member:/, ""), m.party]));

const byParty: Record<string, { bills: number; sections: number; headline: number; costly: number; buried: number }> =
  {};

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
    const long = rel.filter((a) => (a.text_chars ?? 0) >= 5000);
    console.log(
      `  ${side.padEnd(6)} avg chars ${mean(read.map((a) => a.text_chars ?? 0))
        .replace(/\.\d+$/, "")
        .padStart(
          5,
        )}  sections/article if 5000+ chars ${mean(long.map((a) => matches[a.id]!.sections.length))} (n ${long.length})\n  ${" ".repeat(6)} read ${String(read.length).padStart(3)}  about-bill ${pct(main.length, read.length).padStart(4)}  sections/article ${mean(rel.map((a) => matches[a.id]!.sections.length))}  whole ${pct(rel.filter((a) => matches[a.id]!.whole).length, rel.length)}`,
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

  const costly = scores.filter(
    (s) =>
      stakes({ dollarsMusd: s.dollars_musd, dollarsSplit: s.dollars_split, lobbyingReports: s.lobbying_reports }) >=
      SCORE.costlyMin,
  );
  const buriedN = count("buried");
  const byBaseline = (s: (typeof scores)[number]) =>
    (s.evidence as { dollars_by_baseline?: { musd: number }[] }).dollars_by_baseline ?? [];
  const twoBaselines = scores.filter((s) => byBaseline(s).length > 1);
  if (twoBaselines.length) {
    const bar = (musd: number) =>
      stakes({ dollarsMusd: musd, dollarsSplit: "exact", lobbyingReports: 0 }) >= SCORE.costlyMin;
    console.log(
      `CBO printed ${twoBaselines.length} sections against two baselines: ${twoBaselines.filter((s) => byBaseline(s).some((b) => bar(b.musd))).length} are costly on at least one, ${twoBaselines.filter((s) => byBaseline(s).every((b) => bar(b.musd))).length} on every one (only those count)`,
    );
  }
  const measured = scores.some((s) => s.dollars_musd !== null && s.dollars_split !== "even_split") || costly.length > 0;
  console.log(
    `costly (stakes at least ${SCORE.costlyMin.toFixed(3)}): ${costly.length}; of them quiet (buried) ${pct(buriedN, costly.length)}, loud (headline) ${pct(costly.filter((s) => s.label === "headline").length, costly.length)}; late among buried ${pct(scores.filter((s) => s.label === "buried" && s.late).length, buriedN)} (late among all sections ${pct(late.length, final)})`,
  );
  const att = await readRows("attention", bill);
  const relevantBySide = (
    att.find((a) => a.section_id === null)?.evidence as { relevant_by_side?: Record<string, number> } | undefined
  )?.relevant_by_side;
  if (relevantBySide && costly.length) {
    const costlyIds = new Set(costly.map((s) => s.section_id));
    const quietOn = (side: Side) =>
      att
        .filter((a) => a.section_id && costlyIds.has(a.section_id))
        .filter((a) => {
          const hits = Object.entries(a.hits_by_group as Record<string, number>)
            .filter(([g]) => sideOf(g as Parameters<typeof sideOf>[0]) === side)
            .reduce((n, [, h]) => n + h, 0);
          return hits / Math.max(relevantBySide[side] ?? 1, 1) < SCORE.quietShare;
        }).length;
    console.log(
      `costly sections that would be quiet counting one side's press alone: left ${pct(quietOn("left"), costly.length)}, center ${pct(quietOn("center"), costly.length)}, right ${pct(quietOn("right"), costly.length)} (balanced: ${pct(buriedN, costly.length)})`,
    );
  }
  const p = party.get(b?.sponsor_bioguide ?? "") ?? "?";
  if (measured && scores.some((s) => s.attention_pct !== null)) {
    byParty[p] ??= { bills: 0, sections: 0, headline: 0, costly: 0, buried: 0 };
    const t = byParty[p];
    t.bills++;
    t.sections += final;
    t.headline += count("headline");
    t.costly += costly.length;
    t.buried += buriedN;
  }
}

console.log("\n## pooled by sponsor party, bills where the rule could run (news ranked and a cost measured)");
for (const [p, t] of Object.entries(byParty))
  console.log(
    `${p}: ${t.bills} bills, ${t.sections} sections; headline ${pct(t.headline, t.sections)} of sections; costly ${pct(t.costly, t.sections)} of sections; buried ${pct(t.buried, t.costly)} of costly sections`,
  );
