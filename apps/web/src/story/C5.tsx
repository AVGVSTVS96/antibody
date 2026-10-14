import { useMemo } from "react";
import { count, day } from "../lib/format.ts";
import type { BillModel } from "../lib/model.ts";
import { billHref, memberHref, onLink, sectionHref } from "../lib/router.ts";
import { Note, Tag } from "../ui/primitives.tsx";
import { Src } from "../ui/receipt.tsx";
import { ChapterPage } from "./ChapterPage.tsx";
import { ch5, listAnd, shortDay, type Tie } from "./data.ts";
import { Cap, RuleChip } from "./parts.tsx";

function Card({ t, m, win }: { t: Tie; m: BillModel; win: string }) {
  const id = m.b.bill.id;
  return (
    <li>
      <details className="tie">
        <summary>
          <span className="tie-name">
            <b>{t.name}</b>
            {t.ticker && <Tag tone="ink">{t.ticker}</Tag>}
          </span>
          <span className="tie-meta">
            <span>{t.sections.map((v) => m.secLabel(v)).join(" · ")}</span>
            <span className="tie-members" title={win}>
              {t.members.map((x) => (
                <i key={x.id} />
              ))}
              {count(t.members.length, "member").toUpperCase()}
            </span>
          </span>
        </summary>
        <div className="tie-open">
          {t.members.length > 0 ? (
            <ul>
              {t.members.map((x) => (
                <li key={x.id}>
                  <a href={memberHref(id, x.id.slice(7))} onClick={onLink}>
                    {x.name.replace(/^(Sen|Rep)\.\s+/, "")}
                  </a>
                  <span>{count(x.trades, "trade")}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small">No member has a trade in this stock in the window.</p>
          )}
          <p className="tie-src">
            <Src ids={t.claims} label="LDA FILINGS" /> <Src ids={t.listing} label="COMPANY LISTING" />
            {t.tradeClaims.length > 0 && <Src ids={t.tradeClaims} label="TRADES" />}
          </p>
          <a className="tie-go" href={sectionHref(id, m.sectionSlug(t.sections[0]!))} onClick={onLink}>
            Follow {t.name}'s money ↗
          </a>
        </div>
      </details>
    </li>
  );
}

export default function Ch5({ m }: { m: BillModel }) {
  const c = useMemo(() => ch5(m), [m]);
  const { data } = c;
  const id = m.b.bill.id;
  const win = data.window ? `${shortDay(data.window[0])} – ${day(data.window[1])}` : "";
  const first = data.ties[0];
  const names = data.rest.map((t) => t.name);
  return (
    <ChapterPage
      head={c.head}
      lede={c.lede}
      inference={data.ties.length > 0}
      kicker={data.ties.length > 0 && <span className="whole">THIS WHOLE CHAPTER IS INFERENCE</span>}
      prose={c.read.slice(2)}
      chips={
        data.ties.length > 0 && (
          <>
            <RuleChip bundle={m.b} id="tied-stock" />
            <Src ids={data.shown.flatMap((t) => t.listing)} label="SEC COMPANY LIST" />
          </>
        )
      }
      notes={
        data.ties.length > 0 && (
          <>
            <p className="small floor">
              Companies are matched by name, so {data.ties.length} is a floor.
              {data.recall ? ` ${data.recall}` : ""}
            </p>
            <Note title="A TIE IS NOT A BENEFIT" tone="dashed">
              A filing that names a section says the company lobbied on it, not that it gained. No source here links a
              provision to a firm, so no row says the bill helped it.
            </Note>
          </>
        )
      }
      ledger={
        first
          ? { label: "Follow a tie's money", tag: "MONEY", href: sectionHref(id, m.sectionSlug(first.sections[0]!)) }
          : { label: "Open the ledger", tag: "X-RAY", href: billHref(id) }
      }
    >
      {data.ties.length > 0 && (
        <>
          <Cap>1 tie = 1 row · quiet sections its filings name · members who traded its stock {win}</Cap>
          <ul className="ties">
            {data.shown.map((t) => (
              <Card key={t.id} t={t} m={m} win={win} />
            ))}
          </ul>
          {names.length > 0 && (
            <p className="small">
              + {names.length} more
              {data.restTraded ? "" : ", none with a member trade in the window"}: {listAnd(names.slice(0, 8))}
              {names.length > 8 ? ` and ${names.length - 8} others` : ""}.
            </p>
          )}
        </>
      )}
    </ChapterPage>
  );
}
