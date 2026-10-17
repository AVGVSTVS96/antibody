import { Fragment, useMemo, useState } from "react";
import { baselineWords, count, day, musd, rank } from "../lib/format.ts";
import type { BillModel, SectionView } from "../lib/model.ts";
import { Inf, Sources, Src } from "../ui/claims.tsx";

type Filter = "top" | "all" | "headline" | "buried" | "late" | "money" | "removed";
type Sort = "num" | "attention" | "dollars" | "buried";

const FILTERS: [Filter, string][] = [
  ["top", "Top 25"],
  ["all", "All"],
  ["headline", "Loud"],
  ["buried", "Quiet and costly"],
  ["late", "Added late"],
  ["money", "Has CBO $"],
  ["removed", "Dropped"],
];

const TOP = 25;
const PAGE = 50;

const keep: Record<Exclude<Filter, "top">, (v: SectionView) => boolean> = {
  all: () => true,
  headline: (v) => v.kind === "headline",
  buried: (v) => v.kind === "buried",
  late: (v) => v.s.late,
  money: (v) => v.s.dollars.length > 0,
  removed: (v) => !v.s.inFinal,
};

const sorter: Record<Sort, (a: SectionView, b: SectionView) => number> = {
  num: (a, b) => a.stage - b.stage,
  attention: (a, b) => (b.s.attention?.pct ?? -1) - (a.s.attention?.pct ?? -1),
  dollars: (a, b) => Math.abs(b.dollarsMusd ?? 0) - Math.abs(a.dollarsMusd ?? 0),
  buried: (a, b) => (b.s.score?.buried ?? -1) - (a.s.score?.buried ?? -1),
};

const figureNote = (v: SectionView) =>
  v.figure
    ? [
        `${v.figure.estimate.versionScored}; ${v.figure.estimate.baselineLabel}`,
        ...v.figure.byBaseline
          .filter((b) => b.baseline !== v.figure!.baseline)
          .map((b) => `also ${musd(b.musd)} against ${baselineWords(b.baseline)}; the smaller figure counts`),
      ].join("; ")
    : "";

const matches = (f: Filter, v: SectionView, top: Set<string>) => (f === "top" ? top.has(v.s.id) : keep[f](v));

/** What a reader should see first: buried candidates, headline sections, then late and lobbied ones, by news rank. */
const priority = (v: SectionView) =>
  (v.kind === "buried" ? 4 : v.kind === "headline" ? 3 : 0) +
  (v.s.late ? 2 : 0) +
  (v.s.attention?.pct ?? 0) +
  Math.min(1, v.lobbied / 20);

export function XrayList({ m }: { m: BillModel }) {
  const topIds = useMemo(
    () =>
      new Set(
        m.sections
          .filter((v) => v.s.inFinal)
          .sort((a, b) => priority(b) - priority(a))
          .slice(0, TOP)
          .map((v) => v.s.id),
      ),
    [m],
  );
  const [filter, setFilter] = useState<Filter>(m.sections.length > 30 ? "top" : "all");
  const [limit, setLimit] = useState(PAGE);
  const [sort, setSort] = useState<Sort>("num");
  const [open, setOpen] = useState<string | null>(null);
  const all = useMemo(
    () => m.sections.filter((v) => matches(filter, v, topIds)).sort(sorter[sort]),
    [m, filter, sort, topIds],
  );
  const rows = filter === "top" ? all : all.slice(0, limit);
  const firstIn = (code: string) => m.sections.filter((v) => v.s.firstVersion === code).length;

  return (
    <div className="xray">
      <details className="xr-versions" open>
        <summary>Text versions ({m.versions.length}), first text to law</summary>
        <div className="timeline">
          {m.versions.map((v, i) => {
            const prev = m.versions[i - 1];
            const added = firstIn(v.code);
            return (
              <div className={`tl${v.predecessor ? " pred" : ""}`} key={v.code}>
                <div className="d">{day(v.date)}</div>
                <div className="t">{v.name}</div>
                <div className="m">
                  {count(v.sections, "section")} · {(v.words / 1000).toFixed(1)}k words
                </div>
                {i > 0 && (
                  <div className="delta">
                    {added > 0 && <span className="add">+{added} new </span>}
                    {prev && <span className="dim">{signed(v.words - prev.words)} words</span>}
                  </div>
                )}
                <span className="chips">
                  <Src id={v.claim} label="text" /> {v.predecessor && <Inf />}
                </span>
              </div>
            );
          })}
        </div>
      </details>

      <div className="xr-h">
        <h2>Every section</h2>
        <p>{count(m.sections.length, "section")} ever seen. Click a row for its history.</p>
      </div>
      <fieldset className="filters" aria-label="Filter sections">
        {FILTERS.map(([f, label]) => {
          const n = m.sections.filter((v) => matches(f, v, topIds)).length;
          if (
            (f !== "all" && f !== "top" && !n) ||
            (f === "top" && m.sections.length <= TOP) ||
            (f === "late" && m.b.bill.lateUnavailable)
          )
            return null;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => {
                setFilter(f);
                setLimit(PAGE);
              }}
            >
              {label} {f !== "top" && n}
            </button>
          );
        })}
      </fieldset>
      <details className="xr-cols">
        <summary>What the columns mean</summary>
        <p className="row-meta">
          <b>Loudness</b>: 0 to 100, where 100 is the most-covered section of this bill; the number after the dot is how
          many news articles matched it. <b>CBO 10-yr $</b>: the section’s ten-year effect on the deficit, + adds to it
          and − cuts it; hover for the estimate and baseline.
          <b> Buried score</b>: stakes × quietness × (late or off-topic), from 0 to 1.5. A section is flagged when its
          stakes are big (a CBO figure of $10 billion or more, the smaller one when CBO printed two baselines, or 21
          lobbying reports) and under 1 in 100 articles discussed it; the score only orders the flagged ones. It is 0.00
          for most sections, which means nothing about them stands out.
          {!m.perSectionDollars && " CBO scored only the whole bill, so no section has a dollar figure here."}
        </p>
      </details>
      <div className="secwrap">
        <table className="secs">
          <thead>
            <tr>
              <th className="c-n">
                <SortBtn s="num" cur={sort} set={setSort}>
                  §
                </SortBtn>
              </th>
              <th>Section</th>
              <th>{sort === "num" ? "Late?" : "Added in"}</th>
              <th>
                <SortBtn s="attention" cur={sort} set={setSort}>
                  Loudness · articles
                </SortBtn>
              </th>
              <th className="c-x">
                <SortBtn s="dollars" cur={sort} set={setSort}>
                  CBO 10-yr $
                </SortBtn>
              </th>
              <th className="c-x">
                <SortBtn s="buried" cur={sort} set={setSort}>
                  Quiet score
                </SortBtn>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v, i) => {
              const s = v.s;
              const isOpen = open === s.id;
              const cls = !s.inFinal ? "removed" : v.kind === "headline" || v.kind === "buried" ? v.kind : "";
              const grouped = sort === "num" && (i === 0 || rows[i - 1]!.stage !== v.stage);
              return (
                <Fragment key={s.id}>
                  {grouped && (
                    <tr className="grp">
                      <td colSpan={6}>
                        {i === 0 && v.stage === 0 ? "In the first text: " : "First appear in "}
                        <b>{v.stageName.replace(/ \(.*\)$/, "")}</b>
                        <span className="dim">
                          {" "}
                          · {count(rows.filter((x) => x.stage === v.stage).length, "section")}
                        </span>
                      </td>
                    </tr>
                  )}
                  <tr className={`row ${cls}`} onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen}>
                    <td className="n">{m.secLabel(v)}</td>
                    <td className="ttl">
                      {s.heading} {v.kind === "headline" && <span className="pill loud">loud</span>}
                      {v.kind === "buried" && <span className="pill quiet">quiet and costly</span>}
                      {!s.inFinal && (
                        <span className="pill removed">
                          {s.mergedInto ? "merged" : s.splitInto.length ? "split" : "dropped"}
                        </span>
                      )}
                    </td>
                    <td className="when">
                      {sort === "num" ? (
                        <span className={`stagecode${s.late ? " late" : ""}`}>{s.late ? "late" : ""}</span>
                      ) : (
                        <span className="stagecode">{v.stageName.replace(/ \(.*\)$/, "")}</span>
                      )}
                    </td>
                    <td className="loud">
                      {s.attention?.pct == null ? (
                        <span className="miss" title="Too little news coverage on this bill to rank sections">
                          {s.attention ? count(s.attention.hits, "article") : "—"}
                        </span>
                      ) : (
                        <div className="att" title={`${count(s.attention.hits, "article")} matched this section`}>
                          <div className="bar">
                            <i style={{ width: `${s.attention.pct * 100}%` }} />
                          </div>
                          <span>
                            {rank(s.attention.pct)} <span className="dim">· {s.attention.hits}</span>
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="cbo" data-l="CBO 10-yr $">
                      {v.dollarsMusd == null ? (
                        <span className="miss">—</span>
                      ) : (
                        <span className="money" title={figureNote(v)}>
                          {musd(v.dollarsMusd)}
                          {!s.inFinal && <span className="dim"> est. for an earlier version</span>}
                        </span>
                      )}
                    </td>
                    <td className="bur" data-l="Quiet score">
                      {s.score?.buried != null ? (
                        <span className="num">{s.score.buried.toFixed(2)}</span>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="detail">
                      <td colSpan={6}>
                        <SectionDetail m={m} v={v} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {filter === "top" && m.sections.length > TOP && (
        <button type="button" className="more" onClick={() => setFilter("all")}>
          Show all {count(m.sections.length, "section")}
        </button>
      )}
      {filter !== "top" && all.length > rows.length && (
        <button type="button" className="more" onClick={() => setLimit(limit + PAGE)}>
          Show {Math.min(PAGE, all.length - rows.length)} more of {all.length - rows.length} left
        </button>
      )}
      {!rows.length && <p className="dim">No section matches.</p>}
    </div>
  );
}

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n).toLocaleString("en-US")}`;

function SortBtn({ s, cur, set, children }: { s: Sort; cur: Sort; set: (s: Sort) => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={cur === s} onClick={() => set(s)}>
      {children}
      {cur === s && s !== "num" ? " ↓" : ""}
    </button>
  );
}

function SectionDetail({ m, v }: { m: BillModel; v: SectionView }) {
  const s = v.s;
  const counterpart = s.counterpart ? m.sectionById.get(s.counterpart.sectionId) : null;
  return (
    <div>
      <div className="quote" style={{ marginTop: 8 }}>
        {s.preview}…
      </div>
      <div className="hist">
        {m.versions
          .filter((x) => s.history[x.code])
          .map((x) => {
            const h = s.history[x.code]!;
            return (
              <div className="h" key={x.code}>
                <div className="c">{x.name.replace(/ \(.*\)$/, "")}</div>
                <div>
                  {h.path.replace("sec:", "§")} · {h.words.toLocaleString("en-US")} words
                </div>
                {h.similarity != null && h.match !== "identical" && (
                  <div className="dim">
                    {h.match} match {Math.round(h.similarity * 100)}%
                    {h.wordsAdded != null && ` · +${h.wordsAdded} −${h.wordsRemoved ?? 0}`}
                  </div>
                )}
                {h.match === "identical" && <div className="dim">unchanged</div>}
                {h.largestInserts.slice(0, 2).map((t) => (
                  <div key={t}>
                    <span className="ins">{t.length > 90 ? `${t.slice(0, 90)}…` : t}</span>
                  </div>
                ))}
              </div>
            );
          })}
      </div>
      {s.splitFrom && <div className="row-meta">Split out of an older section, so it is not counted as added.</div>}
      {s.splitInto.length > 0 && (
        <div className="row-meta">Split into {count(s.splitInto.length, "section")} in a later version.</div>
      )}
      {counterpart && s.counterpart && (
        <div className="row-meta">
          Rewritten as §{counterpart.s.num} {counterpart.s.heading} <Inf /> <Src id={s.counterpart.claim} />
        </div>
      )}
      {s.dollars.length > 0 && (
        <div className="subs" style={{ marginTop: 6 }}>
          {s.dollars.map((d) => (
            <span key={d.claim}>
              {d.measure} <b>{musd(d.amountMusd)}</b> {d.period} · {d.baseline}
              {d.split === "even_split" ? " · even split" : ""}
            </span>
          ))}
        </div>
      )}
      <Sources ids={[...s.claims, s.attention?.claim, s.score?.claim, ...s.dollars.map((d) => d.claim)]} max={6} />
    </div>
  );
}
