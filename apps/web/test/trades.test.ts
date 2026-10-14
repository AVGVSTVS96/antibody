import { expect, test } from "bun:test";
import { Bundle } from "@antibody/core";
import genius from "../fixtures/119-s-1582.bundle.json";
import { buildModel } from "../src/lib/model.ts";
import {
  baseRate,
  companiesTiedTo,
  daysBetween,
  medianPerTrader,
  monthly,
  monthOffset,
  rankMembers,
  tradeBook,
  tradeGaps,
  windowCounts,
  windowShare,
} from "../src/lib/trades.ts";

const model = () => buildModel(Bundle.parse(structuredClone(genius)));
const raw = Bundle.parse(genius);
const events = raw.edges.flatMap((e) =>
  e.kind === "traded" ? e.props.events.map((ev) => ({ ...ev, member: e.src })) : [],
);

test("the book holds every event of every traded edge, oldest first, by member and by company", () => {
  const book = tradeBook(model());
  expect(book.all.length).toBe(events.length);
  expect(book.all.map((t) => t.event.date)).toEqual([...book.all.map((t) => t.event.date)].sort());
  expect([...book.byMember.values()].reduce((n, t) => n + t.length, 0)).toBe(events.length);
  expect([...book.byCompany.values()].reduce((n, t) => n + t.length, 0)).toBe(events.length);
  expect(book.span).toEqual([book.all[0]!.event.date, book.all.at(-1)!.event.date]);
});

test("the window is the bundle's own span, and each trade is counted inside or outside it", () => {
  const m = model();
  const book = tradeBook(m);
  expect(book.window).toEqual(m.span);
  const [from, to] = m.span!;
  const inside = events.filter((e) => e.date >= from && e.date <= to).length;
  expect(windowCounts(book.all)).toEqual({ inside, outside: events.length - inside });
  expect(inside).toBeGreaterThan(0);
  expect(new Set(book.all.filter((t) => t.inWindow).map((t) => t.member)).size).toBe(m.tradersDuring);
});

test("a book without a window counts everything outside it", () => {
  const b = Bundle.parse(structuredClone(genius));
  b.versions = b.versions.map((v) => ({ ...v, date: null }));
  b.bill.lawOn = null;
  b.votes = [];
  const book = tradeBook(buildModel(b));
  expect(book.window).toBeNull();
  expect(windowCounts(book.all).inside).toBe(0);
  expect(windowShare(book)).toBeNull();
});

test("monthly lists every calendar month of the span, empty ones as zero, and the counts add up", () => {
  const book = tradeBook(model());
  const months = monthly(book);
  expect(months[0]!.month).toBe("2024-05");
  expect(months.at(-1)!.month).toBe("2026-07");
  expect(months.length).toBe(27);
  expect(months.reduce((n, x) => n + x.trades, 0)).toBe(events.length);
  expect(months.find((x) => x.month === "2026-04")!.trades).toBeGreaterThan(0);
  expect(months.map((x) => x.month)).toEqual([...months.map((x) => x.month)].sort());
});

test("the window's days are split across the months it touches", () => {
  const book = tradeBook(model());
  const [from, to] = book.window!;
  expect(monthly(book).reduce((n, x) => n + x.windowDays, 0)).toBe(daysBetween(from, to));
});

test("a member's months line up with everyone's and add up to their trades", () => {
  const book = tradeBook(model());
  const [id, trades] = [...book.byMember].sort((a, b) => b[1].length - a[1].length)[0]!;
  const all = monthly(book);
  const mine = monthly(book, id);
  expect(mine.map((x) => x.month)).toEqual(all.map((x) => x.month));
  expect(mine.reduce((n, x) => n + x.trades, 0)).toBe(trades.length);
  expect(monthly(book, "member:NOBODY").every((x) => x.trades === 0)).toBe(true);
});

test("monthOffset places a date by its day within its month", () => {
  const months = monthly(tradeBook(model()));
  expect(monthOffset(months, "2024-05-01")).toBe(0);
  expect(monthOffset(months, "2024-06-01")).toBe(1);
  expect(monthOffset(months, "2024-06-16")).toBeCloseTo(1.5, 5);
  expect(monthOffset(months, "2020-01-01")).toBe(0);
  expect(monthOffset(months, "2030-01-01")).toBe(months.length);
});

test("the median counts only members who filed a trade, and averages the middle two", () => {
  const book = tradeBook(model());
  const counts = [...book.byMember.values()].map((t) => t.length).sort((a, b) => a - b);
  const mid = counts.length >> 1;
  expect(medianPerTrader(book)).toBe(counts.length % 2 ? counts[mid]! : (counts[mid - 1]! + counts[mid]!) / 2);
  expect(counts.every((n) => n > 0)).toBe(true);
  expect(medianPerTrader({ ...book, byMember: new Map() })).toBe(0);
});

test("window share sets the share of trades beside the share of days", () => {
  const book = tradeBook(model());
  const s = windowShare(book)!;
  expect(s.trades).toBe(events.length);
  expect(s.tradeShare).toBeCloseTo(s.inside / s.trades, 10);
  expect(s.dayShare).toBeCloseTo(s.windowDays / s.days, 10);
  expect(s.days).toBe(daysBetween(book.span![0], book.span![1]));
});

test("base rates count each tie among all members, by party, and both is never more than either", () => {
  const m = model();
  const r = baseRate(m);
  expect(r.members).toBe(m.members.length);
  expect(r.traded).toBe(tradeBook(m).byMember.size);
  expect(r.both).toBeLessThanOrEqual(Math.min(r.traded, r.gifted));
  for (const k of ["members", "traded", "gifted", "both"] as const)
    expect(r.byParty.R[k] + r.byParty.D[k] + r.byParty.I[k]).toBe(r[k]);
  expect(r.both).toBeGreaterThan(0);
});

test("a base rate narrowed to some companies counts only their stock and their PACs", () => {
  const m = model();
  const book = tradeBook(m);
  const [company] = [...book.byCompany].sort((a, b) => b[1].length - a[1].length)[0]!;
  const r = baseRate(m, new Set([company]));
  expect(r.traded).toBe(new Set(book.byCompany.get(company)!.map((t) => t.member)).size);
  expect(baseRate(m, new Set()).traded).toBe(0);
});

test("companies tied to a section are the listed companies its lobbying clients merge into", () => {
  const m = model();
  const section = m.sections.find((v) => v.s.inFinal)!;
  expect(companiesTiedTo(m, [section.s.id]).size).toBe(0);
  const client = m.actors.find((a) => a.kind === "company" && a.clients.length)!;
  const edge = m.edges.find((e) => e.kind === "lobbied" && e.src === client.id)!;
  m.edges.push({ ...edge, dst: `section:${section.s.id}` });
  const fresh = companiesTiedTo({ ...m }, [section.s.id]);
  expect(fresh.has(client.id)).toBe(true);
});

test("members are ranked by how many of the companies they traded, then by name", () => {
  const m = model();
  const book = tradeBook(m);
  const companies = new Set([...book.byCompany.keys()].slice(0, 6));
  const ranked = rankMembers(m, companies);
  expect(ranked.length).toBeGreaterThan(0);
  for (let i = 1; i < ranked.length; i++) {
    const [a, b] = [ranked[i - 1]!, ranked[i]!];
    expect(
      a.companies > b.companies || (a.companies === b.companies && a.member.node.label <= b.member.node.label),
    ).toBe(true);
  }
  expect(ranked.every((r) => r.companies >= 1 && r.inWindow <= r.trades)).toBe(true);
  expect(rankMembers(m, new Set())).toEqual([]);
});

test("the trade gaps are the notes about what the trade counts leave out", () => {
  const gaps = tradeGaps(raw);
  expect(gaps.length).toBeGreaterThan(0);
  expect(gaps.every((g) => g.kind === "paper_filings_unread" || /trades/.test(g.text))).toBe(true);
});
