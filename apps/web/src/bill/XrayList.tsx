import { Fragment, useMemo, useState } from "react";
import { count, day, musd, rank } from "../lib/format.ts";
import type { BillModel, SectionView } from "../lib/model.ts";
import { Inf, Sources, Src } from "../ui/claims.tsx";
import { useFocus } from "./focus.ts";

type Filter = "all" | "headline" | "buried" | "late" | "money" | "removed";
type Sort = "num" | "attention" | "dollars" | "buried";

const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["headline", "Headline"],
  ["buried", "Buried candidates"],
  ["late", "Added late"],
  ["money", "Has CBO $"],
  ["removed", "Dropped"],
];

const keep: Record<Filter, (v: SectionView) => boolean> = {
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
  v.figure ? `${v.figure.estimate.versionScored}; ${v.figure.estimate.baselineLabel}` : "";

export function XrayList({ m }: { m: BillModel }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("num");
  const [open, setOpen] = useState<string | null>(null);
  const focus = useFocus();
  const rows = useMemo(() => m.sections.filter(keep[filter]).sort(sorter[sort]), [m, filter, sort]);
  const firstIn = (code: string) => m.sections.filter((v) => v.s.firstVersion === code).length;

  return (
    <div className="xray">
      <div className="xr-h">
        <span className="cap">Versions</span>
        <span className="cap">first text to law</span>
      </div>
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

      <div className="xr-h">
        <span className="cap">Sections</span>
        <span className="cap">{count(m.sections.length, "section")} ever seen · click a row for its history</span>
      </div>
      <fieldset className="filters" aria-label="Filter sections">
        {FILTERS.map(([f, label]) => {
          const n = m.sections.filter(keep[f]).length;
          if ((f !== "all" && !n) || (f === "late" && m.b.bill.lateUnavailable)) return null;
          return (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {label} {n}
            </button>
          );
        })}
      </fieldset>
      <p className="row-meta">
        <b>Loudness</b>: 0 to 100, where 100 is the most-covered section of this bill; the number after the dot is how
        many news articles matched it. <b>CBO 10-yr $</b>: the section’s ten-year effect on the deficit, + adds to it
        and − cuts it; hover for the estimate and baseline.
        <b> Buried score</b>: stakes × quietness × (late or off-topic), from 0 to 1.5; a section is a buried candidate
        at 0.45 or more with big stakes. It is 0.00 for most sections, which means nothing about them stands out.
        {!m.perSectionDollars && " CBO scored only the whole bill, so no section has a dollar figure here."}
      </p>
      <table className="secs">
        <thead>
          <tr>
            <th>
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
            <th className="hide-s">
              <SortBtn s="dollars" cur={sort} set={setSort}>
                CBO 10-yr $
              </SortBtn>
            </th>
            <th className="hide-s">
              <SortBtn s="buried" cur={sort} set={setSort}>
                Buried score
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
                      <span className="dim"> · {count(rows.filter((x) => x.stage === v.stage).length, "section")}</span>
                    </td>
                  </tr>
                )}
                <tr
                  className={`row ${cls}`}
                  onClick={() => setOpen(isOpen ? null : s.id)}
                  onPointerEnter={() => focus.setHover(`section:${s.id}`)}
                  onPointerLeave={() => focus.setHover(null)}
                  aria-expanded={isOpen}
                >
                  <td className="n">{m.secLabel(v)}</td>
                  <td>
                    {s.heading} {v.kind === "headline" && <span className="pill headline">headline</span>}
                    {v.kind === "buried" && <span className="pill buried">buried candidate</span>}
                    {!s.inFinal && (
                      <span className="pill removed">
                        {s.mergedInto ? "merged" : s.splitInto.length ? "split" : "dropped"}
                      </span>
                    )}
                  </td>
                  <td>
                    {sort === "num" ? (
                      <span className={`stagecode${s.late ? " late" : ""}`}>{s.late ? "late" : ""}</span>
                    ) : (
                      <span className="stagecode">{v.stageName.replace(/ \(.*\)$/, "")}</span>
                    )}
                  </td>
                  <td>
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
                  <td className="hide-s">
                    {v.dollarsMusd == null ? (
                      <span className="miss">{m.perSectionDollars ? "—" : "whole bill"}</span>
                    ) : (
                      <span className="money" title={figureNote(v)}>
                        {musd(v.dollarsMusd)}
                        {!s.inFinal && <span className="dim"> est. for an earlier version</span>}
                      </span>
                    )}
                  </td>
                  <td className="hide-s">
                    {s.score?.buried != null ? (
                      <span className="mono">{s.score.buried.toFixed(2)}</span>
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
