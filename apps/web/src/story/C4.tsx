import { useMemo, useState } from "react";
import { count, usd } from "../lib/format.ts";
import type { BillModel } from "../lib/model.ts";
import { billHref, sectionHref } from "../lib/router.ts";
import { Note, Stat, StatRow, Tag } from "../ui/primitives.tsx";
import { Src, useReceipt } from "../ui/receipt.tsx";
import { ChapterPage } from "./ChapterPage.tsx";
import { type Ch4Data, ch4, landedOf, spend } from "./data.ts";
import { Cap, Num } from "./parts.tsx";

type Phase = keyof Ch4Data["phases"];
const PHASES: Phase[] = ["bill", "enactmentQuarter", "law"];

function Clients({ c, phase }: { c: Ch4Data; phase: Phase | null }) {
  const { open } = useReceipt();
  const max = Math.max(1, ...c.clients.map((x) => x.reports));
  return (
    <ul className="cl-rows">
      {c.clients.map((x) => (
        <li key={x.id}>
          <button type="button" className="cl-head" onClick={() => open(x.claims, { label: x.name })}>
            <b>{x.name}</b>
            <span>
              {x.reports}
              {x.spendUsd != null && ` · ${spend(x.spendUsd)}`}
            </span>
          </button>
          <div className="cl-sq" style={{ "--max": max } as React.CSSProperties} aria-hidden="true">
            {PHASES.flatMap((p) =>
              Array.from({ length: x.phases[p] }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: squares have no identity
                <i key={`${p}${i}`} data-phase={p} data-dim={phase && phase !== p ? "" : undefined} />
              )),
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Ch4({ m }: { m: BillModel }) {
  const c = useMemo(() => ch4(m), [m]);
  const { data } = c;
  const [phase, setPhase] = useState<Phase | null>(null);
  const names: Record<Phase, string> = {
    bill: "AS A BILL",
    enactmentQuarter: "ENACTMENT QUARTER",
    law: data.lawName ? `AS ${data.lawName.toUpperCase()}` : "AS A LAW",
  };
  const topId = data.top[0];
  const id = m.b.bill.id;
  return (
    <ChapterPage
      head={c.head}
      lede={c.lede}
      prose={c.read.slice(2)}
      chips={
        data.reports > 0 && (
          <>
            <Src ids={data.claims} label="LDA.GOV FILINGS" />
            {m.b.lobbying.spendTotalUsd != null && (
              <Src ids={data.claims} label={`${usd(m.b.lobbying.spendTotalUsd)} TOTAL`} />
            )}
          </>
        )
      }
      notes={
        data.top.length > 0 && (
          <Note title="REPORT COUNTS, NOT DOLLARS" tone="dashed">
            A filing gives one total per client, so spending cannot be split by section: we show report counts per
            section, never spend.
          </Note>
        )
      }
      ledger={
        topId
          ? { label: "Follow a section's money", tag: "MONEY", href: sectionHref(id, m.sectionSlug(topId.v)) }
          : { label: "Open the ledger", tag: "X-RAY", href: billHref(id) }
      }
    >
      {data.reports > 0 && (
        <>
          <section>
            <Cap>What the filings called it</Cap>
            <div className="phase-bar" role="toolbar" aria-label="Filter the squares by how the filing named the bill">
              {PHASES.map(
                (p) =>
                  data.phases[p] > 0 && (
                    <button
                      type="button"
                      key={p}
                      data-phase={p}
                      style={{ flexGrow: data.phases[p] }}
                      aria-pressed={phase === p}
                      aria-label={`${names[p]}: ${data.phases[p]}`}
                      onClick={() => setPhase(phase === p ? null : p)}
                    />
                  ),
              )}
            </div>
            <StatRow size="md">
              {PHASES.map((p) => (
                <Stat key={p} value={data.phases[p].toLocaleString("en-US")} label={names[p]} />
              ))}
            </StatRow>
          </section>
          {data.clients.length > 0 && (
            <section>
              <Cap aside={<span className="axis">REPORTS · $ ALL ISSUES</span>}>
                {data.clients.length === 10 ? "Ten busiest clients" : `${data.clients.length} busiest clients`} · 1
                square = 1 report
              </Cap>
              <ul className="legend" aria-hidden="true">
                {PHASES.map((p) => (
                  <li key={p} data-phase={p}>
                    <i />
                    {names[p]}
                  </li>
                ))}
              </ul>
              <Clients c={data} phase={phase} />
              <p className="small">
                The busiest client has {data.clients[0]!.reports} of the {data.reports.toLocaleString("en-US")} reports.
                {data.limited ? ` ${data.limited}` : ""}
              </p>
            </section>
          )}
          <section>
            <Cap>Where in the bill they named</Cap>
            <p>
              {data.mentions
                ? `Filings named a section number ${data.mentions.toLocaleString("en-US")} times; a report that names two sections counts twice. Those mentions land on ${landedOf(data.landed, data.sections)}. Every other mention names only the bill.`
                : "No filing names a section number: every mention names only the bill."}
            </p>
            {data.top.length > 0 && (
              <ul className="sec-rows">
                {data.top.map(({ v, reports }) => (
                  <li key={v.s.id} data-kind={v.kind}>
                    <Num m={m} v={v} />
                    <a className="plain title" href={sectionHref(id, m.sectionSlug(v))}>
                      {v.s.heading}
                      {v.kind === "buried" && (
                        <Tag tone="quiet" small>
                          QUIET
                        </Tag>
                      )}
                      {v.kind === "headline" && (
                        <Tag tone="ink" small>
                          LOUD
                        </Tag>
                      )}
                    </a>
                    <i className="bar" style={{ width: `${(100 * reports) / data.topMax}%` }} />
                    <b>
                      <Src ids={v.s.score!.claim} label={String(reports)} />
                    </b>
                  </li>
                ))}
              </ul>
            )}
            {data.unmentioned > 0 && (
              <p className="punch">
                {data.unmentioned === data.topCount
                  ? `All ${data.unmentioned}`
                  : `${data.unmentioned} of the ${data.topCount}`}{" "}
                most-named sections drew no mentions in the {count(data.articles, "article")} read.
              </p>
            )}
          </section>
        </>
      )}
    </ChapterPage>
  );
}
