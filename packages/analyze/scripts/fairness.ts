import { join } from "node:path";
import { parseBillId } from "@antibody/core";
import { paths, readRows } from "@antibody/core/node";
import { OUTLETS, SIDES, sideOf } from "@antibody/ingest-news";
import type { Side } from "@antibody/ingest-news";
import { z } from "zod";
import { MIN_TEXT_CHARS } from "../src/attention.ts";
import { SCORE, stakes } from "../src/score.ts";

const MatchesFile = z.object({
  matches: z.record(
    z.string(),
    z.object({ about: z.string().optional(), sections: z.array(z.string()), whole: z.boolean().optional() }),
  ),
});

const ScoreEvidence = z.object({ dollars_by_baseline: z.array(z.object({ musd: z.number() })).optional() });
const AttentionEvidence = z.object({ relevant_by_side: z.record(z.string(), z.number()).optional() });
const HitsByGroup = z.record(z.string(), z.number());

const groupOf = new Map(OUTLETS.map((o) => [o.domain, o.group]));

const sideOfOutlet = (outletId: string | null) => {
  const group = outletId === null || outletId === "" ? undefined : groupOf.get(outletId);

  return group === undefined ? null : sideOf(group);
};

const costlyFigure = (musd: number) =>
  stakes({ dollarsMusd: musd, dollarsSplit: "exact", lobbyingFirms: 0 }) >= SCORE.costlyMin;

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : "-");
const mean = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : "-");

const members = await readRows("members").catch(() => []);
const party = new Map(members.map((m) => [m.id.replace(/^member:/u, ""), m.party]));

const byParty = new Map<
  string,
  { bills: number; sections: number; headline: number; costly: number; buried: number }
>();

for (const arg of Bun.argv.slice(2)) {
  const bill = parseBillId(arg);
  const [b] = await readRows("bills", bill);
  const sections = await readRows("sections", bill);
  const articles = await readRows("articles", bill);
  const scores = (await readRows("section_scores", bill)).filter((s) => (s.part_id ?? "") === "");

  const file = Bun.file(
    join(paths.raw("analyze"), "match", `${bill}.${process.env.ANTIBODY_MATCH_MODEL ?? "sonnet"}.json`),
  );

  const matches = (await file.exists()) ? MatchesFile.parse(await file.json()).matches : {};

  console.log(
    `\n## ${bill} ${b?.short_title ?? ""} (sponsor ${b?.sponsor_bioguide ?? "?"}, party ${party.get(b?.sponsor_bioguide ?? "") ?? "?"})`,
  );

  console.log("\nmatcher by side (articles read):");

  for (const side of ["left", "center", "right"] as const) {
    const read = articles.flatMap((a) => {
      const m = matches[a.id];

      return (a.text_chars ?? 0) >= MIN_TEXT_CHARS && sideOfOutlet(a.outlet_id) === side && m !== undefined
        ? [{ ...a, m }]
        : [];
    });

    const rel = read.filter((a) => a.m.about !== "unrelated");
    const main = read.filter((a) => a.m.about === "bill");
    const long = rel.filter((a) => (a.text_chars ?? 0) >= 5000);
    console.log(
      `  ${side.padEnd(6)} avg chars ${mean(read.map((a) => a.text_chars ?? 0))
        .replace(/\.\d+$/u, "")
        .padStart(
          5,
        )}  sections/article if 5000+ chars ${mean(long.map((a) => a.m.sections.length))} (n ${long.length})\n  ${" ".repeat(6)} read ${String(read.length).padStart(3)}  about-bill ${pct(main.length, read.length).padStart(4)}  sections/article ${mean(rel.map((a) => a.m.sections.length))}  whole ${pct(rel.filter((a) => a.m.whole === true).length, rel.length)}`,
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
        .flatMap((s) => (s.attention_pct === null ? [] : [s.attention_pct]))
        .toSorted((x, y) => x - y)
        .slice(Math.floor(withAtt.length / 2), Math.floor(withAtt.length / 2) + 1),
    )}; sections with dollars ${pct(scores.filter((s) => s.dollars_musd !== null).length, final)}; with lobbying ${pct(scores.filter((s) => s.lobbying_reports > 0).length, final)}`,
  );
  console.log(`sections total ${sections.length}`);

  const costly = scores.filter(
    (s) =>
      (s.offsets_section_id ?? "") === "" &&
      stakes({ dollarsMusd: s.dollars_musd, dollarsSplit: s.dollars_split, lobbyingFirms: s.lobbying_firms }) >=
        SCORE.costlyMin,
  );

  const buriedN = count("buried");

  const byBaseline = (s: (typeof scores)[number]) =>
    ScoreEvidence.safeParse(s.evidence).data?.dollars_by_baseline ?? [];

  const twoBaselines = scores.filter((s) => byBaseline(s).length > 1);

  if (twoBaselines.length) {
    console.log(
      `CBO printed ${twoBaselines.length} sections against two baselines: ${twoBaselines.filter((s) => byBaseline(s).some((x) => costlyFigure(x.musd))).length} are costly on at least one, ${twoBaselines.filter((s) => byBaseline(s).every((x) => costlyFigure(x.musd))).length} on every one (only those count)`,
    );
  }

  const measured = scores.some((s) => s.dollars_musd !== null && s.dollars_split !== "even_split") || costly.length > 0;
  console.log(
    `costly (stakes at least ${SCORE.costlyMin.toFixed(3)}): ${costly.length}; of them quiet (buried) ${pct(buriedN, costly.length)}, loud (headline) ${pct(costly.filter((s) => s.label === "headline").length, costly.length)}; late among buried ${pct(scores.filter((s) => s.label === "buried" && s.late).length, buriedN)} (late among all sections ${pct(late.length, final)})`,
  );
  const att = await readRows("attention", bill);

  const relevantBySide = AttentionEvidence.safeParse(att.find((a) => a.section_id === null)?.evidence).data
    ?.relevant_by_side;

  if (relevantBySide !== undefined && costly.length > 0) {
    const costlyIds = new Set(costly.map((s) => s.section_id));

    const quietOn = (side: Side) =>
      att.filter((a) => {
        if (a.section_id === null || !costlyIds.has(a.section_id)) {
          return false;
        }

        const hits = Object.entries(HitsByGroup.parse(a.hits_by_group))
          .filter(([g]) => SIDES[side].some((x) => x === g))
          .reduce((n, [, h]) => n + h, 0);

        return hits / Math.max(relevantBySide[side] ?? 1, 1) < SCORE.quietShare;
      }).length;

    console.log(
      `costly sections that would be quiet counting one side's press alone: left ${pct(quietOn("left"), costly.length)}, center ${pct(quietOn("center"), costly.length)}, right ${pct(quietOn("right"), costly.length)} (balanced: ${pct(buriedN, costly.length)})`,
    );
  }

  const p = party.get(b?.sponsor_bioguide ?? "") ?? "?";

  if (measured && scores.some((s) => s.attention_pct !== null)) {
    const t = byParty.get(p) ?? { bills: 0, sections: 0, headline: 0, costly: 0, buried: 0 };
    byParty.set(p, t);
    t.bills++;
    t.sections += final;
    t.headline += count("headline");
    t.costly += costly.length;
    t.buried += buriedN;
  }
}

console.log("\n## pooled by sponsor party, bills where the rule could run (news ranked and a cost measured)");

for (const [p, t] of byParty) {
  console.log(
    `${p}: ${t.bills} bills, ${t.sections} sections; headline ${pct(t.headline, t.sections)} of sections; costly ${pct(t.costly, t.sections)} of sections; buried ${pct(t.buried, t.costly)} of costly sections`,
  );
}
