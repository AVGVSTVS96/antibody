import type { BillStats, Bundle, Featured, Section } from "./bundle.ts";
import { sectionFigure } from "./dollars.ts";
import { inBillOrder } from "./order.ts";

interface Ranked {
  id: string;
  latestActionOn: string | null;
  stats: Pick<BillStats, "buried" | "buriedTest" | "lobbyingReports"> | null;
}

/**
 * landing-order (docs/rules.md): bills the quiet-and-costly test could run on come first, then the most quiet and
 * costly sections, then the most lobbying reports, then the newest. The same for every bill; the first is the
 * featured bill. Bills with no stats are left out.
 */
export function landingOrder<B extends Ranked>(bills: B[]): (B & { stats: NonNullable<B["stats"]> })[] {
  return bills
    .filter((b): b is B & { stats: NonNullable<B["stats"]> } => b.stats != null)
    .sort(
      (a, b) =>
        Number(b.stats.buriedTest.tested) - Number(a.stats.buriedTest.tested) ||
        b.stats.buried - a.stats.buried ||
        b.stats.lobbyingReports - a.stats.lobbyingReports ||
        (b.latestActionOn ?? "").localeCompare(a.latestActionOn ?? "") ||
        a.id.localeCompare(b.id),
    );
}

const isPassage = (v: Bundle["votes"][number]) => /on passage/i.test(v.question) && /^(bill )?passed/i.test(v.result);

/** A section's figure in the bundle's latest per-section estimate (or any estimate for a section outside the final text). */
export function shownFigure(b: Bundle, s: Section) {
  const f = sectionFigure(
    s.dollars.filter((d) => d.baseline === "current-law"),
    b.dollars.estimates,
  );
  return f && (f.fromLatest || !s.inFinal) ? f : null;
}

type Row = Featured["rows"][number];

/**
 * landing-exhibit (docs/rules.md): of the bill's quiet and costly sections, the one most lobbying filings name, then
 * the one with the larger CBO figure, then the earlier one. Null when there is none.
 */
function exhibitOf(b: Bundle, rows: Row[]): Featured["exhibit"] {
  const size = (r: Row) => Math.abs(r.musd ?? 0);
  const best = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.kind === "quiet")
    .sort((x, y) => y.r.named - x.r.named || size(y.r) - size(x.r) || x.i - y.i)[0];
  if (!best) return null;
  const s = b.sections.find((x) => x.id === best.r.id)!;
  const figure = shownFigure(b, s);
  const version = b.versions.find((v) => v.code === s.firstVersion);
  const passed =
    best.r.late && version?.date
      ? b.votes.filter((v) => isPassage(v) && v.date < version.date!).sort((x, y) => x.date.localeCompare(y.date))[0]
      : undefined;
  return {
    row: best.i,
    period:
      (figure && s.dollars.find((d) => d.estimateId === figure.estimateId && d.baseline === "current-law")?.period) ??
      null,
    figureClaims: figure?.claims ?? [],
    firstText: version ? { name: version.name, date: version.date, claim: version.claim } : null,
    passed: passed ? { chamber: passed.chamber, date: passed.date, claim: passed.claim } : null,
  };
}

/** The front page's block for one bundle. `deficitMusd` is the bill's headline deficit (its stats), whose claims it cites. */
export function featuredOf(b: Bundle, deficitMusd: number | null): Featured {
  const nums = new Map<string, number>();
  for (const s of b.sections) nums.set(s.num, (nums.get(s.num) ?? 0) + 1);
  const drawn = new Map<string, number>();
  for (const e of b.edges)
    if (e.kind === "lobbied" && e.dst.startsWith("section:"))
      drawn.set(e.dst.slice(8), (drawn.get(e.dst.slice(8)) ?? 0) + e.props.reports);

  const final = inBillOrder(b.sections.filter((s) => s.inFinal));
  const lateKnown = !b.bill.lateUnavailable;
  const rows = final.map((s): Row => {
    const figure = shownFigure(b, s);
    return {
      id: s.id,
      slug: nums.get(s.num) === 1 ? s.num : s.id,
      num: s.num,
      heading: s.heading,
      path: s.path,
      kind: s.score?.label === "headline" ? "headline" : s.score?.label === "buried" ? "quiet" : "other",
      musd: figure?.musd ?? null,
      evenSplit: figure?.split === "even_split",
      late: lateKnown && s.late,
      articles: s.attention?.hits ?? null,
      named: s.score?.components.lobbyingReports ?? drawn.get(s.id) ?? 0,
      scoreClaim: s.score?.claim ?? null,
      attentionClaim: s.attention?.claim ?? null,
    };
  });
  const lateCodes = new Set(final.filter((s) => lateKnown && s.late).map((s) => s.firstVersion));
  return {
    billId: b.bill.id,
    read: b.attention.sample?.relevant ?? b.attention.articles,
    lateReason: b.bill.lateUnavailable ?? null,
    rows,
    exhibit: exhibitOf(b, rows),
    deficitClaims:
      deficitMusd == null
        ? []
        : b.dollars.wholeBill.flatMap((d) =>
            d.measure === "deficit" && d.amountMusd === deficitMusd ? [d.claim] : [],
          ),
    lateVersionClaims: b.versions.flatMap((v) => (lateCodes.has(v.code) ? [v.claim] : [])),
    claimShards: b.claimShards ?? null,
    rules: b.rules,
  };
}
