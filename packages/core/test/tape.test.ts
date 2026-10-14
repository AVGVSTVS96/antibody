import { expect, test } from "bun:test";
import fixture from "../fixtures/genius-mini.bundle.json";
import { Bundle, type Section } from "../src/bundle.ts";
import { dollarLevel, levelOf, QUIET_RUN, tapeOf } from "../src/tape.ts";
import { indexTotals } from "../src/totals.ts";

const bundle = Bundle.parse(fixture);

interface Mark {
  label?: "headline" | "buried" | "normal";
  musd?: number | null;
  even?: boolean;
  late?: boolean;
  hits?: number;
  scored?: boolean;
}

const section = (n: number, m: Mark = {}): Section => {
  const claim = Object.keys(bundle.claims)[0]!;
  return {
    ...bundle.sections[0]!,
    id: `s${n}`,
    num: String(n),
    inFinal: true,
    late: m.late ?? false,
    attention:
      m.hits === undefined ? null : { hits: m.hits, pct: 0, hitsByGroup: {}, tradeLegalHits: 0, examples: [], claim },
    score:
      m.scored === false
        ? null
        : {
            label: m.label ?? "normal",
            buried: null,
            components: {
              dollarsMusd: m.musd ?? null,
              dollarsSplit: m.musd == null ? null : m.even ? "even_split" : "exact",
              attentionPct: null,
              late: m.late ?? false,
              offTopic: null,
              lobbyingReports: 0,
            },
            claim,
          },
  };
};

const quiet = (n: number, musd: number): [number, Mark] => [n, { label: "buried", musd, hits: 0 }];
const bill = (marks: Record<number, Mark>, length: number) =>
  Array.from({ length }, (_, i) => section(i, marks[i] ?? {}));

test("dollars fall into five size classes by absolute value, the same for adds and cuts", () => {
  const edges = [0.1, 99.9, 100, 999, 1_000, 9_999, 10_000, 99_999, 100_000, 3_000_000];
  expect(edges.map(dollarLevel)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  expect(dollarLevel(-12_406)).toBe(dollarLevel(12_406));
});

test("a section's tape characters carry sign, size and absence, and decode back", () => {
  const { tape } = tapeOf(
    bill(
      { 0: { musd: 50 }, 1: { musd: -12_406 }, 2: { musd: 0 }, 3: {}, 4: { musd: 250_000 }, 5: { scored: false } },
      6,
    ),
    true,
  );
  expect(tape.dollars).toBe("1d0.5.");
  expect([...tape.dollars].map(levelOf)).toEqual([1, -4, 0, null, 5, null]);
});

test("late flags follow the sections, and are all off when the bill's late flag is unavailable", () => {
  const sections = bill({ 1: { late: true }, 3: { late: true } }, 5);
  expect(tapeOf(sections, true).tape.late).toBe(".l.l.");
  expect(tapeOf(sections, false).tape.late).toBe(".....");
});

test("an even share of a group line is listed apart and kept out of the quiet totals", () => {
  const sections = bill(
    { 1: { label: "buried", musd: 5_000, even: true, hits: 0 }, 2: { label: "buried", musd: -2_000, hits: 0 } },
    4,
  );
  const out = tapeOf(sections, true);
  expect(out.tape.evenSplit).toEqual([1]);
  expect(out.tape.dollars).toBe(".3c.");
  expect(out.quietCost).toEqual({ addedMusd: 0, cutMusd: 2_000, measured: 1 });
});

test("quiet-and-costly totals split adds from cuts", () => {
  const sections = bill(Object.fromEntries([quiet(2, 14_911), quiet(3, 29_730), quiet(4, -11_557)]), 8);
  expect(tapeOf(sections, true).quietCost).toEqual({ addedMusd: 44_641, cutMusd: 11_557, measured: 3 });
});

test("mentions count every section's hits and the headline sections' share; null when sections were not ranked", () => {
  const ranked = bill(
    { 0: { label: "headline", hits: 7 }, 1: { hits: 2 }, 2: { label: "headline", hits: 1 }, 3: { hits: 0 } },
    4,
  );
  expect(tapeOf(ranked, true).mentions).toEqual({ headline: 8, total: 10 });
  expect(tapeOf(bill({}, 4), true).mentions).toBeNull();
});

test("the run is the longest chain of quiet marks at most five sections apart, and needs three marks", () => {
  expect(QUIET_RUN).toEqual({ maxGap: 5, minMarks: 3 });
  const marks = Object.fromEntries([
    quiet(2, 10_000),
    quiet(7, -20_000),
    quiet(12, 30_000),
    quiet(30, 5_000),
    quiet(31, 6_000),
    quiet(40, 1_000),
  ]);
  expect(tapeOf(bill(marks, 50), true).quietRun).toEqual({
    from: 2,
    to: 12,
    fromNum: "2",
    toNum: "12",
    marks: 3,
    added: 2,
    cut: 1,
    minMusd: 10_000,
    maxMusd: 30_000,
    hits: 0,
  });
  expect(tapeOf(bill(Object.fromEntries([quiet(2, 1), quiet(20, 1), quiet(21, 1)]), 30), true).quietRun).toBeNull();
  expect(tapeOf(bill({}, 5), true).quietRun).toBeNull();
});

test("a bill with no sections has an empty tape", () => {
  expect(tapeOf([], true)).toMatchObject({ tape: { late: "", dollars: "", evenSplit: [] }, quietRun: null });
});

test("totals count a trade, a PAC to member pair and a member once across bills", () => {
  const other: Bundle = { ...structuredClone(bundle), bill: { ...bundle.bill, id: "119-hr-1" } };
  const alone = indexTotals([bundle]);
  expect(alone.trades).toBeGreaterThan(0);
  expect(alone.bills).toBe(1);
  const both = indexTotals([bundle, other]);
  expect({ ...both, bills: 1, sections: alone.sections }).toEqual(alone);
  expect(both.bills).toBe(2);
});
