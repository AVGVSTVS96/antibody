import { expect, test } from "bun:test";
import { Bundle } from "@antibody/core";
import genius from "../fixtures/119-s-1582.bundle.json";
import {
  answers,
  eraLine,
  eras,
  introLine,
  monthly,
  niceMax,
  phases,
  spread,
  timeline,
  traders,
} from "../src/lib/derive.ts";
import { buildModel } from "../src/lib/model.ts";
import { fingerprintCells } from "../src/ui/Fingerprint.tsx";

const m = buildModel(Bundle.parse(genius));

test("the timeline runs first text, each chamber's passage with its tally, then signing", () => {
  const steps = timeline(m);
  expect(steps[0]!.label).toBe("First text");
  expect(steps.map((s) => s.label)).toEqual(["First text", "Senate passes it", "House passes it", "Signed into law"]);
  expect(steps[1]!.detail).toBe("Jun 17, 2025, 68 to 30");
  expect(steps.at(-1)!.signed).toBe(true);
});

test("the intro reads the deficit in plain words", () => {
  expect(introLine(m)).toMatch(
    /^20 sections became law\. CBO says the law adds \$120 million to the deficit over 11 years\./,
  );
});

test("four answers, each with a jump target", () => {
  const a = answers(m);
  expect(a.map((x) => x.tone)).toEqual(["loud", "quiet", "money", "trade"]);
  expect(a[2]!.big).toBe(`${m.b.lobbying.clients} clients`);
  expect(a.every((x) => x.target && x.link)).toBe(true);
});

test("eras group final sections by the version they first appear in", () => {
  const groups = eras(m);
  expect(groups.reduce((n, g) => n + g.sections.length, 0)).toBe(m.sections.filter((v) => v.s.inFinal).length);
  expect(groups.map(eraLine).every((l) => /section/.test(l))).toBe(true);
});

test("lobbying phases add up and traders are ranked by trades", () => {
  const { rows, total } = phases(m);
  expect(rows.reduce((n, r) => n + r.n, 0)).toBe(total);
  const t = traders(m);
  expect(t.every((x, i) => i === 0 || t[i - 1]!.v.tradeCount >= x.v.tradeCount)).toBe(true);
});

test("monthly trade counts cover every month between the first and last trade", () => {
  const { months, total } = monthly(m);
  expect(months.reduce((n, x) => n + x.n, 0)).toBe(total);
  const keys = months.map((x) => x.key);
  expect(new Set(keys).size).toBe(keys.length);
});

test("very large laws pack sections into squares, loudest mark first", () => {
  const exact = fingerprintCells("nnhnb", 52);
  expect(exact).toEqual({ cells: ["n", "n", "h", "n", "b"], per: 1 });
  const big = fingerprintCells(`${"n".repeat(1999)}b`, 52);
  expect(big.per).toBe(4);
  expect(big.cells.at(-1)).toBe("b");
  expect(big.cells.length).toBeLessThanOrEqual(520);
});

test("dot offsets are stable and chart ticks are round", () => {
  expect(spread("a")).toBe(spread("a"));
  expect(Math.abs(spread("a"))).toBeLessThanOrEqual(1);
  expect(niceMax(36)).toBe(40);
  expect(niceMax(229)).toBe(250);
});

const withBuriedDollars = (musd: number, heading?: string) => {
  const b = Bundle.parse(structuredClone(genius));
  b.dollars.estimates[0]!.perSection = true;
  const s = b.sections.find((x) => x.inFinal && x.score?.label === "buried")!;
  if (heading) s.heading = heading;
  s.dollars = [
    {
      estimateId: b.dollars.estimates[0]!.id,
      baseline: "current-law",
      measure: "deficit",
      spending: null,
      period: "2025-2035",
      amountMusd: musd,
      split: "exact",
      claim: Object.keys(b.claims)[0]!,
    },
  ];
  return buildModel(b);
};

test("the flagged tile says whether the figure saves or costs", () => {
  expect(answers(withBuriedDollars(-122_151))[1]!.big).toBe("saves $122B");
  expect(answers(withBuriedDollars(23_400))[1]!.big).toBe("costs $23B");
});

test("a long heading ends the flagged tile's sentence once, not with an ellipsis and a period", () => {
  const long = "Extension of moratorium on implementation of rule relating to the elimination of the safe harbor";
  expect(answers(withBuriedDollars(-122_151, long))[1]!.text).toMatch(/…\s\d+ articles? matched it/);
  expect(answers(withBuriedDollars(-122_151, "Short heading"))[1]!.text).toMatch(/§19, short heading\. \d/);
});

test("revenue CBO lists but does not score is said beside the scored deficit line", () => {
  const b = Bundle.parse(structuredClone(genius));
  const d = b.dollars.wholeBill.find((w) => w.measure === "deficit")!;
  b.dollars.wholeBill.push({ ...d, measure: "nonscorable_revenues", amountMusd: 180_388, claim: d.claim });
  expect(introLine(buildModel(b))).toContain(
    "adds $120 million to the deficit over 11 years, and expects $180 billion more in revenue that it does not score.",
  );
});

test("members with unread paper filings come from the bundle, drawn in the graph or not", () => {
  const b = Bundle.parse(structuredClone(genius));
  b.paperUnread = { R: 1, D: 1, I: 0 };
  expect(buildModel(b).unread).toEqual({ R: 1, D: 1, I: 0 });
});
