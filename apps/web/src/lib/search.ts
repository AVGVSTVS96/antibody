import type { BundleIndex } from "@antibody/core";
import { type BillId, billDisplay, parseBillId } from "@antibody/core/ids";
import type { BillModel, SectionView } from "./model.ts";

export type IndexBill = BundleIndex["bills"][number];

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** A bill number the way a person types it: `S.1582`, `H.R. 1`, `119-hr-1` or a congress.gov link. Congress null = not given. */
function typedBill(q: string): { id: BillId; congress: number | null } | null {
  try {
    const id = parseBillId(q, 0);
    return { id, congress: +id.split("-")[0]! || null };
  } catch {
    return null;
  }
}

const sameNumber = (b: IndexBill, typed: BillId) =>
  b.id.split("-").slice(1).join("-") === typed.split("-").slice(1).join("-");

function scoreBill(b: IndexBill, q: string, ws: string[]): number {
  const typed = typedBill(q);
  if (typed && (typed.congress ? b.id === typed.id : sameNumber(b, typed.id))) return 100;
  const flat = squash(q);
  const display = squash(b.display);
  if (flat && display.startsWith(flat)) return 70;
  const name = words(`${b.shortTitle ?? ""} ${b.title} ${b.law ?? ""}`);
  const short = squash(b.shortTitle ?? "");
  if (flat && short.startsWith(flat)) return 60;
  if (ws.every((w) => name.some((n) => n.startsWith(w)))) return 40;
  return 0;
}

/** Bills of the index by number, short title, title or law number; newest first among equals. With no query: the whole library. */
export function searchBills(bills: IndexBill[], q: string, limit = 8): IndexBill[] {
  const query = q.trim();
  const newest = (a: IndexBill, b: IndexBill) => (b.latestActionOn ?? "").localeCompare(a.latestActionOn ?? "");
  if (!query) return [...bills].sort(newest).slice(0, limit);
  const ws = words(query);
  return bills
    .map((b) => ({ b, score: scoreBill(b, query, ws) }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || newest(x.b, y.b))
    .slice(0, limit)
    .map((x) => x.b);
}

/** A bill the reader named that the library does not have (a pasted congress.gov link, say). */
export function missingBill(bills: IndexBill[], q: string): { id: BillId; display: string } | null {
  try {
    const id = parseBillId(q.trim());
    return bills.some((b) => b.id === id) ? null : { id, display: billDisplay(id) };
  } catch {
    return null;
  }
}

const sectionNum = (q: string) =>
  q
    .trim()
    .replace(/^(?:§|sec(?:tion)?\.?\s*)/i, "")
    .trim();

/** Sections still in the final text, by number (exact first, then prefix) or heading words. */
export function searchSections(m: BillModel, q: string, limit = 8): SectionView[] {
  const num = sectionNum(q);
  if (!num) return [];
  const ws = words(num);
  const final = m.sections.filter((v) => v.s.inFinal);
  const rank = (v: SectionView) => {
    if (v.s.num === num) return 3;
    if (/^\d/.test(num) && v.s.num.startsWith(num)) return 2;
    return ws.every((w) => words(v.s.heading).some((h) => h.startsWith(w))) ? 1 : 0;
  };
  return final
    .map((v) => ({ v, r: rank(v) }))
    .filter((x) => x.r > 0)
    .sort((x, y) => y.r - x.r)
    .slice(0, limit)
    .map((x) => x.v);
}
