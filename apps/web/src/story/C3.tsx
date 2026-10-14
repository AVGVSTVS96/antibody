import { useMemo, useState } from "react";
import { count } from "../lib/format.ts";
import type { BillModel } from "../lib/model.ts";
import { billHref, sectionHref } from "../lib/router.ts";
import { Note, Stat, StatRow } from "../ui/primitives.tsx";
import { Src } from "../ui/receipt.tsx";
import { DollarRow } from "./Bars.tsx";
import { ChapterPage } from "./ChapterPage.tsx";
import { bigUsd, bigUsdSum, ch3, ch3Head, figure } from "./data.ts";
import { Cap } from "./parts.tsx";
import { useTween } from "./tween.ts";

type Kind = "loud" | "quiet" | "other";
const KIND_LABEL: Record<Kind, string> = { loud: "LOUD", quiet: "QUIET", other: "OTHER" };

export default function Ch3({ m }: { m: BillModel }) {
  const c = useMemo(() => ch3(m), [m]);
  const { data } = c;
  const [pick, setPick] = useState(0);
  const [kind, setKind] = useState<Kind | null>(null);
  const chosen = data.baselines[pick];
  const shown = useTween(chosen?.d.amountMusd ?? 0);
  const head = chosen ? ch3Head(chosen, shown) : c.head;
  const mv = data.movement;
  const total = mv ? mv.loud + mv.quiet + mv.other : 0;
  const share = (x: number) => (total ? `${((100 * x) / total).toFixed(1)}%` : "0%");
  const scale = Math.max(1, ...data.biggest.map((s) => Math.abs(s.musd)));
  const sections = (k: Kind) => [...data.byKind[k]].sort((x, y) => Math.abs(y.musd) - Math.abs(x.musd)).slice(0, 5);
  const label = data.sectionBaseline?.baselineLabel;

  const gap =
    data.gap != null && data.billTotal != null ? (
      <Note title="GAP SHOWN · SECTIONS ≠ BILL TOTAL" tone="dashed">
        Section lines add up to {figure(data.sectionSum)}. CBO's bill total is {figure(data.billTotal)}.{" "}
        {Math.abs(data.sectionSum) <= Math.abs(data.billTotal)
          ? `The ${bigUsd(data.gap)} gap is dollars CBO did not pin to one section.`
          : `The two differ by ${bigUsd(data.gap)}: CBO prints some dollars only for the whole bill or for a group of sections.`}{" "}
        {count(data.noFigure, "section")} {data.noFigure === 1 ? "has" : "have"} no CBO figure at all, and{" "}
        {data.evenSplit} {data.evenSplit === 1 ? "shows" : "show"} an even share of a shared line.
      </Note>
    ) : data.gaps.length && !mv && m.b.dollars.estimates.length ? (
      <Note title="GAP SHOWN · NO DOLLARS PER SECTION" tone="dashed">
        {data.gaps.join(" ")}
      </Note>
    ) : null;

  return (
    <ChapterPage
      head={head}
      lede={c.lede}
      kicker={data.kicker}
      prose={[
        mv
          ? `Sections add ${bigUsd(data.added)} and cut ${bigUsd(data.cut)}. Gross movement counts adds and cuts alike; it is not net cost. Quiet is about coverage and timing, not size.`
          : undefined,
      ]}
      chips={chosen && <Src ids={data.baselines.map((b) => b.est.claim)} label="CBO ESTIMATE" />}
      notes={gap}
      ledger={{
        label: mv ? `Sort all ${m.sections.filter((v) => v.s.inFinal).length} sections by dollars` : "Open the ledger",
        tag: "X-RAY",
        href: billHref(m.b.bill.id),
      }}
    >
      {data.baselines.length > 0 && (
        <div className="bl-cards" data-n={data.baselines.length}>
          {data.baselines.map((b, i) => (
            <div key={b.d.baseline} className="bl" data-on={i === pick || undefined}>
              <button
                type="button"
                className="bl-pick"
                aria-pressed={i === pick}
                disabled={data.baselines.length === 1}
                onClick={() => setPick(i)}
              >
                <small>
                  {b.label}
                  {i === pick && data.baselines.length > 1 ? " ✓" : ""}
                </small>
                <strong>{figure(b.d.amountMusd)}</strong>
              </button>
              <Src ids={b.d.claim} label={`CBO ${b.est.id.replace(/^.*cbo-/, "")}`} />
            </div>
          ))}
        </div>
      )}
      {mv && (
        <section className="moves">
          <Cap>Where the dollars move</Cap>
          <p>
            Sections add {bigUsd(data.added)} and cut {bigUsd(data.cut)}. Gross movement,{" "}
            {bigUsdSum(data.added, data.cut)}, counts adds and cuts alike: it is not net cost. Quiet is about coverage
            and timing, not size: it can sit on a small dollar figure or a big one.
          </p>
          <div className="move-bar" role="toolbar" aria-label="Gross movement by kind of section">
            {(["other", "loud", "quiet"] as const).map(
              (k) =>
                mv[k] > 0 && (
                  <button
                    type="button"
                    key={k}
                    data-kind={k}
                    style={{ flexGrow: mv[k] }}
                    aria-pressed={kind === k}
                    aria-label={`${KIND_LABEL[k]} sections: ${bigUsd(mv[k])}`}
                    onClick={() => setKind(kind === k ? null : k)}
                  />
                ),
            )}
          </div>
          <StatRow size="md">
            {(["other", "loud", "quiet"] as const).map((k) => (
              <Stat
                key={k}
                tone={k === "quiet" && data.byKind.quiet.length ? "quiet" : undefined}
                value={bigUsd(mv[k])}
                label={
                  k === "quiet" && !data.quietTested
                    ? "quiet sections: bill not tested"
                    : `${data.byKind[k].length} ${k} section${data.byKind[k].length === 1 ? "" : "s"}${k === "quiet" ? ` (${share(mv.quiet)})` : ""}`
                }
              />
            ))}
          </StatRow>
          {kind && (
            <ul className="move-open">
              {sections(kind).map((s) => (
                <li key={s.v.s.id}>
                  <a href={sectionHref(m.b.bill.id, m.sectionSlug(s.v))}>
                    {m.secLabel(s.v)} {s.v.s.heading}
                  </a>
                  <Src ids={s.v.figure!.claims} label={bigUsd(s.musd)} />
                </li>
              ))}
            </ul>
          )}
          <Cap aside={<span className="axis">← CUTS DEFICIT · ADDS →</span>}>Ten biggest sections</Cap>
          {label && <p className="small">Section lines: {label}.</p>}
          <ul className="q-rows">
            {data.biggest.map((s, i) => (
              <DollarRow
                key={s.v.s.id}
                m={m}
                v={s.v}
                dollars={s.musd}
                evenSplit={s.evenSplit}
                scale={scale}
                i={i}
                tag={s.v.kind === "headline" ? "loud" : s.v.kind === "buried" ? "quiet" : undefined}
              />
            ))}
          </ul>
        </section>
      )}
    </ChapterPage>
  );
}
