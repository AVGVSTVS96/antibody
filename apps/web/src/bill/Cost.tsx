import { articlesOf, BIG_STAKES } from "@antibody/core";
import { Fragment, type KeyboardEvent, useMemo, useRef, useState } from "react";
import { dots, quietZone, sectionName } from "../lib/derive.ts";
import { baselineWords, count, day, deficitWords, usd } from "../lib/format.ts";
import { useWidth } from "../lib/hooks.ts";
import type { BillModel, SectionView } from "../lib/model.ts";
import { frameFor, notes, type Placed, place, scales } from "../lib/scatter.ts";
import { Inf, Src } from "../ui/claims.tsx";
import { Section } from "./Section.tsx";

const OUTLETS_URL = "https://github.com/AVGVSTVS96/antibody/blob/main/packages/ingest-news/data/outlets.json";

export function Cost({ m }: { m: BillModel }) {
  const points = useMemo(() => dots(m), [m]);
  const ranked = m.sections.some((v) => v.s.attention?.pct != null);
  const first = points.find((p) => p.kind === "buried") ?? points.find((p) => p.kind === "headline");
  const [pick, setPick] = useState<string | null>(first?.v.s.id ?? null);
  const loud = points.filter((p) => p.kind === "headline").length;
  const flagged = points.filter((p) => p.kind === "buried").length;
  const hollow = points.some((p) => p.musd < 0);
  const articles = m.b.attention.sample?.relevant ?? m.b.attention.articles;
  const selected = m.sectionById.get(pick ?? "") ?? null;
  const coverage = m.sections.filter((v) => v.s.inFinal).length >= 8;

  return (
    <Section id="news" title="What the news covered, and what it cost">
      <p className="lead narrow">
        {points.length
          ? "Each dot is one section of the law, placed by how many articles were about it and by what CBO says it costs or saves. Filled dots add to the deficit, hollow dots cut it. Sections without a CBO figure aren’t drawn here."
          : "CBO gave none of this bill’s sections its own cost, so there is no cost to plot."}
      </p>
      <ul className="legend">
        <li>
          <i className="dot iris" />
          The loud part: {count(m.headline.length, "section")}
        </li>
        <li>
          <i className="dot flare big" />
          Quiet and costly: {flagged || m.buried.length}
        </li>
        <li>
          <i className="dot grey" />
          Everything else
        </li>
        {hollow && (
          <li>
            <i className="dot hollow" />
            Hollow: cuts the deficit
          </li>
        )}
      </ul>
      {!ranked && (
        <p className="callout">
          Too few news articles to rank this bill’s sections ({count(m.b.attention.articles, "article")} found), so none
          can be called loud or quiet.
        </p>
      )}
      {(points.length > 0 || coverage) && (
        <div className={`costrow${selected ? "" : " alone"}`}>
          {points.length > 0 ? (
            <Scatter m={m} points={points} pick={pick} onPick={setPick} articles={articles} />
          ) : (
            <Coverage m={m} />
          )}
          {selected && <Facts m={m} v={selected} />}
        </div>
      )}
      <details className="how">
        <summary>How we measured it</summary>
        <HowMeasured m={m} />
      </details>
    </Section>
  );
}

function HowMeasured({ m }: { m: BillModel }) {
  const A = m.b.attention;
  const scored = m.sections.filter((v) => v.s.attention?.pct != null).length;
  const via =
    A.via.map((v) => (v === "mediacloud" ? "Media Cloud" : "Google News")).join(" + ") || "no news source yet";
  return (
    <div>
      <p>
        {scored
          ? `Sections are ranked by news attention, ${scored} in all`
          : "There are too few articles to rank sections; only raw counts are shown"}
        ,{" "}
        {A.sample
          ? `from ${A.sample.relevant.toLocaleString("en-US")} relevant articles read, out of ${A.sample.found.toLocaleString("en-US")} found`
          : `from ${count(A.articles, "article")}`}{" "}
        via {via}
        {A.outletListVersion && (
          <>
            ,{" "}
            <a className="link" href={OUTLETS_URL} target="_blank" rel="noopener">
              outlet list {A.outletListVersion}
            </a>
          </>
        )}
        {A.window ? ` (${day(A.window[0])} to ${day(A.window[1])})` : ""}. Loud means the top tenth of this bill’s
        sections by news attention, with at least 3 matching articles, so it is relative to this bill. A model decides
        which section an article is about, so “no articles” is a lead, not proof.
      </p>
      {m.b.gaps
        .filter((g) => g.kind === "attention_partial")
        .map((g) => (
          <p key={g.id}>
            {g.text} {g.claim && <Src id={g.claim} />}
          </p>
        ))}
    </div>
  );
}

function Scatter({
  m,
  points,
  pick,
  onPick,
  articles,
}: {
  m: BillModel;
  points: ReturnType<typeof dots>;
  pick: string | null;
  onPick: (id: string) => void;
  articles: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const w = useWidth(box);
  const f = useMemo(() => frameFor(w), [w]);
  const s = useMemo(() => scales(points, f), [points, f]);
  const placed = useMemo(() => place(points, f, s), [points, f, s]);
  const zone = useMemo(() => quietZone(m, points), [m, points]);
  const zx = zone ? s.x(zone.hits) : null;
  const zy = zone ? s.y(zone.musd) : null;
  const labels = useMemo(
    () => notes(placed, f, zx != null && zy != null ? { x: zx, y: zy } : null),
    [placed, f, zx, zy],
  );
  const [tip, setTip] = useState<Placed | null>(null);
  const warm = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const phone = f.w < 560;
  const base = f.h - f.b;

  const show = (p: Placed) => {
    clearTimeout(timer.current);
    if (Date.now() - warm.current < 400) setTip(p);
    else timer.current = setTimeout(() => setTip(p), 300);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setTip((t) => {
      if (t) warm.current = Date.now();
      return null;
    });
  };
  const ordered = useMemo(() => [...placed].sort((a, b) => a.cx - b.cx || a.cy - b.cy), [placed]);
  const onKey = (e: KeyboardEvent) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
    e.preventDefault();
    const at = Math.max(
      0,
      ordered.findIndex((p) => p.v.s.id === pick),
    );
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    const next = ordered[Math.min(ordered.length - 1, Math.max(0, at + step))];
    if (next) onPick(next.v.s.id);
  };

  const tipPos = tip && {
    left: Math.min(Math.max(tip.cx, 90), f.w - 90),
    top: tip.cy - tip.r - 10,
    below: tip.cy < 110,
  };

  return (
    <div className="scatter" ref={box}>
      {/* biome-ignore lint/a11y/useSemanticElements: a custom chart widget, driven by the arrow keys */}
      <div
        className="plot"
        role="application"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the chart is one tab stop; arrow keys move between dots
        tabIndex={0}
        aria-label={`Sections placed by news articles and CBO cost. Use the arrow keys to move between ${points.length} sections.`}
        onKeyDown={onKey}
      >
        <svg width={f.w} height={f.h} viewBox={`0 0 ${f.w} ${f.h}`} role="img" aria-hidden="true">
          <text x={f.l} y="14" className="ax strong">
            CBO cost or savings over ten years
          </text>
          <text x={f.l} y="30" className="ax soft">
            Each step up is ten times more money
          </text>
          {zx != null && zy != null && (
            <g>
              <rect x={f.l} y={f.t} width={zx - f.l} height={zy - f.t} fill="var(--flare-soft)" />
              <path
                d={`M${zx} ${f.t}V${zy}M${f.l} ${zy}H${zx}`}
                stroke="var(--flare)"
                strokeOpacity="0.4"
                strokeDasharray="2 3"
                fill="none"
              />
              {!phone && (
                <text className="zone" x={f.l + 8} y={f.t + 18}>
                  <tspan>Quiet and</tspan>
                  <tspan x={f.l + 8} dy="16">
                    costly
                  </tspan>
                </text>
              )}
            </g>
          )}
          {phone && zx != null && (
            <text className="zone" x={zx + 6} y={f.t - 8}>
              Quiet and costly
            </text>
          )}
          {s.yticks.map((t) => (
            <g key={t.musd}>
              <line x1={f.l} x2={f.w - f.r} y1={s.y(t.musd)} y2={s.y(t.musd)} stroke="var(--rule)" />
              <text x={f.l - 12} y={s.y(t.musd) + 4} textAnchor="end" className="ax">
                {t.label}
              </text>
            </g>
          ))}
          <line x1={f.l} x2={f.w - f.r} y1={base} y2={base} stroke="var(--ink-3)" />
          {s.xticks.map((v) => (
            <g key={v}>
              <line x1={s.x(v)} x2={s.x(v)} y1={base} y2={base + 5} stroke="var(--ink-3)" />
              {(v % (s.xmax <= 40 ? 10 : 20) === 0 || v === s.xmax) && (
                <text x={s.x(v)} y={base + 20} textAnchor="middle" className="ax">
                  {v}
                </text>
              )}
            </g>
          ))}
          <text x={f.w - f.r} y={f.h - 6} textAnchor="end" className="ax strong">
            News articles about the section, of {articles.toLocaleString("en-US")} read
          </text>
          <g>
            {placed.map((p) => {
              const colour =
                p.kind === "headline" ? "var(--iris)" : p.kind === "buried" ? "var(--flare)" : "var(--quiet-dot)";
              const on = pick === p.v.s.id;
              return (
                <g key={p.v.s.id} className={`pt${on ? " on" : ""}`}>
                  {p.musd >= 0 ? (
                    <circle
                      cx={p.cx}
                      cy={p.cy}
                      r={p.r}
                      fill={colour}
                      stroke="var(--paper)"
                      strokeWidth={p.kind === "buried" ? 2.5 : 1.5}
                    />
                  ) : (
                    <circle cx={p.cx} cy={p.cy} r={p.r - 0.75} fill="var(--paper)" stroke={colour} strokeWidth="1.5" />
                  )}
                  {on && (
                    <circle
                      cx={p.cx}
                      cy={p.cy}
                      r={p.r + 4}
                      fill="none"
                      stroke="var(--ink)"
                      strokeWidth="1.5"
                      className="ring"
                    />
                  )}
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: keyboard users move through dots with the chart's arrow keys */}
                  <circle
                    cx={p.cx}
                    cy={p.cy}
                    r={Math.max(10, p.r + 4)}
                    fill="transparent"
                    onPointerEnter={() => show(p)}
                    onPointerLeave={hide}
                    onClick={() => onPick(p.v.s.id)}
                    style={{ cursor: "pointer" }}
                  />
                </g>
              );
            })}
          </g>
          {labels.map((n) => {
            const colour = n.tone === "flare" ? "var(--flare-ink)" : n.tone === "iris" ? "var(--iris)" : "var(--ink)";
            return (
              <g key={n.p.v.s.id} className="note" pointerEvents="none">
                {n.lead && (
                  <polyline
                    points={`${n.p.cx},${n.p.cy} ${n.anchor === "start" ? n.x - 4 : n.x + 4},${n.y - 4}`}
                    fill="none"
                    stroke={colour}
                    strokeWidth="1"
                  />
                )}
                <text x={n.x} y={n.y} textAnchor={n.anchor} fill={colour} className="nt">
                  {n.lines[0]}
                </text>
                <text x={n.x} y={n.y + 16} textAnchor={n.anchor} className="ax">
                  {n.lines[1]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {tip && tipPos && (
        <div
          className={`tip${tipPos.below ? " below" : ""}`}
          style={{ left: tipPos.left, top: tipPos.below ? tip.cy + tip.r + 10 : tipPos.top }}
          role="presentation"
        >
          <b>{sectionName(tip.v.s.heading, 56)}</b>
          <span>
            §{tip.v.s.num} · {tip.musd >= 0 ? "+" : "−"}
            {usd(Math.abs(tip.musd) * 1e6)} · {count(tip.hits, "article")}
          </span>
        </div>
      )}
      {phone && (
        <p className="tapnote">
          <i />
          Tap a dot to read it. The flagged one is open below.
        </p>
      )}
    </div>
  );
}

function Coverage({ m }: { m: BillModel }) {
  const final = m.sections.filter((v) => v.s.inFinal);
  const bins = new Map<number, { n: number; loud: number; flagged: number }>();
  for (const v of final) {
    const k = Math.min(articlesOf(v.s) ?? 0, 20);
    const b = bins.get(k) ?? { n: 0, loud: 0, flagged: 0 };
    b.n++;
    if (v.kind === "headline") b.loud++;
    if (v.kind === "buried") b.flagged++;
    bins.set(k, b);
  }
  const top = Math.max(1, ...[...bins.values()].map((b) => b.n));
  const keys = Array.from({ length: Math.max(...bins.keys(), 4) + 1 }, (_, i) => i);
  return (
    <figure className="cover" aria-label="Sections by number of news articles">
      <figcaption>
        <b>Sections by news articles</b>
        <span>Each bar counts sections with that many articles</span>
      </figcaption>
      <div className="cover-bars">
        {keys.map((k) => {
          const b = bins.get(k);
          return (
            <div key={k} className="cb" title={`${b?.n ?? 0} sections with ${k}${k === 20 ? " or more" : ""} articles`}>
              <span className="stack" style={{ height: `${((b?.n ?? 0) / top) * 100}%` }}>
                {b && b.flagged > 0 && <i className="f" style={{ flex: b.flagged }} />}
                {b && b.loud > 0 && <i className="l" style={{ flex: b.loud }} />}
                {b && b.n - b.loud - b.flagged > 0 && <i className="q" style={{ flex: b.n - b.loud - b.flagged }} />}
              </span>
              <em>{k === 20 ? "20+" : k}</em>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

function row(label: string, body: React.ReactNode, src?: React.ReactNode) {
  return (
    <div className="frow">
      <dt>{label}</dt>
      <dd>{body}</dd>
      <dd className="fsrc">{src}</dd>
    </div>
  );
}

export function Facts({ m, v }: { m: BillModel; v: SectionView }) {
  const c = v.s.score?.components;
  const tone = v.kind === "buried" ? "flare" : v.kind === "headline" ? "iris" : "plain";
  const version = m.versions.find((x) => x.code === v.s.firstVersion);
  const A = m.b.attention;
  const hits = v.s.attention?.hits ?? 0;
  const checked = c?.attentionChecked ?? 0;
  const lobbyEdge = m.b.edges.find((e) => e.kind === "lobbied" && e.dst === `section:${v.s.id}`);
  const payFor = v.s.score?.offsets ? m.sections.find((x) => x.s.id === v.s.score?.offsets) : undefined;
  const paidBy = m.sections.find((x) => x.s.score?.offsets === v.s.id);
  const same = !!v.figure?.byBaseline.every((b) => b.musd === v.figure!.musd);
  const why = [
    v.dollarsMusd != null || (c?.lobbyingReports ?? 0) >= BIG_STAKES.reports ? "big" : null,
    "quiet",
    c?.late ? "arrived late" : c?.offTopic != null && c.offTopic >= 0.5 ? "unlike the rest of the bill" : null,
  ].filter(Boolean);
  return (
    <aside className={`facts ${tone}`} aria-live="polite">
      <div className="facts-h">
        <b>
          {v.kind === "buried"
            ? "Flagged: quiet and costly"
            : v.kind === "headline"
              ? "The loud part"
              : "A section of the law"}
        </b>
        {v.kind === "buried" && <span className="tag inf flare">Inference</span>}
      </div>
      <h3>{sectionName(v.s.heading, 90)}</h3>
      <p className="fsec">Section {v.s.num}</p>
      <dl>
        {row(
          "Cost",
          v.dollarsMusd != null ? (
            <>
              {deficitWords(v.dollarsMusd).replace(/^./, (x) => x.toUpperCase())}
              {v.figure && (
                <>
                  {" "}
                  against{" "}
                  {same && v.figure.byBaseline.length > 1
                    ? `both baselines CBO printed (${v.figure.byBaseline.map((b) => baselineWords(b.baseline)).join(" and ")})`
                    : baselineWords(v.figure.baseline)}
                </>
              )}
              {v.figure?.split === "even_split" && " (an even split of a CBO group line)"}
            </>
          ) : (
            "No CBO figure"
          ),
          v.figure && <Src id={v.figure.claims[0]!} label="CBO" />,
        )}
        {v.figure?.byBaseline
          .filter((b) => !same && b.baseline !== v.figure!.baseline)
          .map((b) => (
            <Fragment key={b.baseline}>
              {row(
                "Other baseline",
                <>
                  {deficitWords(b.musd).replace(/^./, (x) => x.toUpperCase())} against {baselineWords(b.baseline)}. The
                  smaller of the two counts.
                </>,
                <Src id={b.claims[0]!} label="CBO" />,
              )}
            </Fragment>
          ))}
        {payFor &&
          row(
            "Pays for",
            <>
              §{payFor.s.num} {sectionName(payFor.s.heading, 60)}: CBO prints exactly the opposite figure for both, so
              this is not flagged on its own.
            </>,
            v.s.score && <Src id={v.s.score.claim} label="Rule" />,
          )}
        {paidBy &&
          row(
            "Paid for by",
            <>
              §{paidBy.s.num} {sectionName(paidBy.s.heading, 60)}: CBO prints exactly the opposite figure for it.
            </>,
            paidBy.s.score && <Src id={paidBy.s.score.claim} label="Rule" />,
          )}
        {row(
          "News",
          v.s.attention?.pct != null || hits ? (
            <>
              {hits + checked} of {(A.sample?.relevant ?? A.articles).toLocaleString("en-US")} articles
              {checked ? ` (${hits} on the first read, ${checked} more on a second look)` : ""}
            </>
          ) : (
            "Not ranked"
          ),
          v.s.attention && <Src id={v.s.attention.claim} label="News" />,
        )}
        {row(
          "Arrived",
          <>{version ? `${version.name}${version.date ? `, ${day(version.date)}` : ""}` : v.stageName}</>,
          v.s.claims[0] && <Src id={v.s.claims[0]} label="GovInfo" />,
        )}
        {row(
          "Lobbying",
          v.lobbied ? `${count(v.lobbied, "report")} name it` : "No reports name it",
          lobbyEdge?.claims[0] && <Src id={lobbyEdge.claims[0]} label="LDA" />,
        )}
      </dl>
      {v.kind === "buried" && (
        <p className="why">
          Flagged because it is {why.join(", ")}. The rule is the same for every bill and party. It marks a place to
          look, not wrongdoing. <Inf />
        </p>
      )}
      {v.kind === "headline" && (
        <p className="why plain">
          One of the most covered sections of this bill. The rule is the same for every bill and party.
        </p>
      )}
      <a className="link legal" href={v.s.textUrl} target="_blank" rel="noopener">
        Read the legal text
      </a>
    </aside>
  );
}
