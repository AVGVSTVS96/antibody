import type { ArticleList } from "@antibody/core";
import { useMemo, useState } from "react";
import { loadArticles } from "../lib/data.ts";
import { count } from "../lib/format.ts";
import type { BillModel, SectionView } from "../lib/model.ts";
import { billHref, sectionHref } from "../lib/router.ts";
import { Src } from "../ui/receipt.tsx";
import { ChapterPage } from "./ChapterPage.tsx";
import { type Ch1Data, ch1, figure, GROUP_SHORT, GROUPS, type Group } from "./data.ts";
import { Cap, Num, RuleChip } from "./parts.tsx";

type Article = ArticleList["articles"][number];

const squaresOf = (v: SectionView): Group[] =>
  GROUPS.flatMap((g) => Array<Group>(v.s.attention?.hitsByGroup[g] ?? 0).fill(g));

function ArticleItem({ a }: { a: Article }) {
  return (
    <li>
      <a href={a.url} target="_blank" rel="noopener noreferrer">
        {a.title}
      </a>
      <span>
        {a.outlet} · {a.group.toUpperCase()}
        {a.date ? ` · ${a.date}` : ""}
      </span>
    </li>
  );
}

function Examples({ v, billId }: { v: SectionView; billId: string }) {
  const [all, setAll] = useState<Article[] | null>(null);
  const [failed, setFailed] = useState(false);
  const a = v.s.attention!;
  const shown = all ?? a.examples;
  const load = () =>
    loadArticles(billId)
      .then((list) => list && setAll((list.bySection[v.s.id] ?? []).map((i) => list.articles[i]!)))
      .catch(() => setFailed(true));
  return (
    <div className="sq-open">
      <ul>
        {shown.map((x) => (
          <ArticleItem key={x.claim} a={x} />
        ))}
      </ul>
      <p className="sq-more">
        {shown.length} shown of {a.hits}.{" "}
        {shown.length < a.hits && !failed && (
          <button type="button" className="linkbtn" onClick={load}>
            Show all {a.hits}
          </button>
        )}
        {failed && "The full list did not load."} <Src ids={a.claim} label={`${count(a.hits, "article")} counted`} />
      </p>
    </div>
  );
}

function Rows({ c, m }: { c: Ch1Data; m: BillModel }) {
  const [group, setGroup] = useState<Group | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <Cap aside={<Src ids={c.claims} label="ATTENTION" />}>
        {c.ranked ? "1 square = 1 article that names the section" : "Counts only: too few articles to rank"}
      </Cap>
      <ul className="sq-rows">
        {c.rows.map((v) => {
          const hits = v.s.attention?.hits ?? 0;
          const isOpen = open === v.s.id;
          return (
            <li key={v.s.id} className="sq-row">
              <div className="sq-head">
                <Num m={m} v={v} />
                <a className="plain title" href={sectionHref(m.b.bill.id, m.sectionSlug(v))}>
                  {v.s.heading}
                </a>
                {v.figure && (
                  <span className="fig">
                    <Src ids={v.figure.claims} label={figure(v.figure.musd)} />
                  </span>
                )}
              </div>
              <button
                type="button"
                className="squares"
                aria-expanded={isOpen}
                aria-label={`${count(hits, "article")} name ${m.secLabel(v)}. ${isOpen ? "Hide" : "Show"} examples`}
                onClick={() => setOpen(isOpen ? null : v.s.id)}
              >
                <span className="grid">
                  {squaresOf(v).map((g, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: squares have no identity
                    <i key={i} data-dim={group && group !== g ? "" : undefined} />
                  ))}
                </span>
                <b>{hits}</b>
              </button>
              {isOpen && v.s.attention && <Examples v={v} billId={m.b.bill.id} />}
            </li>
          );
        })}
      </ul>
      {c.mentions > 0 && (
        <section className="outlets" aria-label="Where the mentions came from">
          <Cap>Where the {count(c.mentions, "mention")} came from</Cap>
          <div className="outlet-bar" role="toolbar" aria-label="Filter the squares by outlet group">
            {c.groups.map(({ group: g, hits }, i) =>
              hits ? (
                <button
                  type="button"
                  key={g}
                  style={{ flexGrow: hits, background: `var(--lean-${i + 1})` }}
                  aria-pressed={group === g}
                  aria-label={`${g}: ${hits}`}
                  onClick={() => setGroup(group === g ? null : g)}
                />
              ) : null,
            )}
          </div>
          <ul className="outlet-key">
            {c.groups.map(({ group: g, hits }) => (
              <li key={g} data-on={group === g || undefined}>
                {GROUP_SHORT[g]} {hits}
              </li>
            ))}
          </ul>
          <p className="small">
            Outlet groups come from one published outlet list{c.outletList ? ` (${c.outletList})` : ""}. They describe
            the outlet, not the bill, and carry no party color here.
          </p>
        </section>
      )}
    </>
  );
}

export default function Ch1({ m }: { m: BillModel }) {
  const c = useMemo(() => ch1(m), [m]);
  const { data } = c;
  const b = m.b;
  return (
    <ChapterPage
      head={c.head}
      lede={c.lede}
      prose={c.read.slice(2)}
      chips={
        <>
          <Src ids={data.claims} label={`${data.articles.toLocaleString("en-US")} ARTICLES READ`} />
          <RuleChip bundle={b} id="attention-v1" />
        </>
      }
      notes={
        <div className="hand-off">
          <b>{data.handoff.value}</b>
          <p>{data.handoff.text}</p>
        </div>
      }
      ledger={
        data.ranked && m.headline.length
          ? {
              label: `All ${count(m.headline.length, "loud section")} in the ledger`,
              tag: "X-RAY",
              href: billHref(b.bill.id),
            }
          : { label: "All sections in the ledger", tag: "X-RAY", href: billHref(b.bill.id) }
      }
    >
      <Rows c={data} m={m} />
    </ChapterPage>
  );
}
