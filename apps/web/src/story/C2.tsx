import { useMemo, useState } from "react";
import { count } from "../lib/format.ts";
import type { BillModel } from "../lib/model.ts";
import { billHref } from "../lib/router.ts";
import { InferenceTag, Note } from "../ui/primitives.tsx";
import { Src } from "../ui/receipt.tsx";
import { DollarRow } from "./Bars.tsx";
import { ChapterPage } from "./ChapterPage.tsx";
import { ch2, type QuietRow } from "./data.ts";
import { Cap, RuleChip } from "./parts.tsx";

function Filings({ m, row }: { m: BillModel; row: QuietRow }) {
  const edges = m.edges.filter((e) => e.kind === "lobbied" && e.dst === `section:${row.v.s.id}`);
  const total = row.v.s.score?.components.lobbyingReports ?? 0;
  const listed = edges.reduce((n, e) => n + e.weight, 0);
  return (
    <div className="q-open">
      <ul>
        {edges.map((e) => (
          <li key={e.id}>
            <b>{m.actorById.get(e.src)?.short ?? e.src}</b>
            <span>{count(e.weight, "report")}</span>
            <Src ids={e.claims} label="LDA" />
          </li>
        ))}
      </ul>
      <p className="small">
        {listed < total
          ? listed
            ? `${count(listed, "report")} of ${total} listed: only the busiest clients are drawn. `
            : `${count(total, "report")} name it. None is from the busiest clients drawn here. `
          : ""}
        {row.v.s.score && <Src ids={row.v.s.score.claim} label={`${total} REPORTS COUNTED`} />}
      </p>
    </div>
  );
}

function Row({ m, row, i, scale }: { m: BillModel; row: QuietRow; i: number; scale: number }) {
  const [open, setOpen] = useState(false);
  const reports = row.v.s.score?.components.lobbyingReports ?? 0;
  return (
    <DollarRow m={m} v={row.v} dollars={row.musd} evenSplit={row.evenSplit} scale={scale} i={i}>
      {reports > 0 && (
        <button type="button" className="lda" aria-expanded={open} onClick={() => setOpen(!open)}>
          {reports} LDA
        </button>
      )}
      {open && <Filings m={m} row={row} />}
    </DollarRow>
  );
}

export default function Ch2({ m }: { m: BillModel }) {
  const c = useMemo(() => ch2(m), [m]);
  const { data } = c;
  const b = m.b;
  const n = data.rows.length;
  const near = data.closest;
  return (
    <ChapterPage
      head={c.head}
      lede={c.lede}
      tone={n ? "quiet" : undefined}
      prose={
        n
          ? ["Quiet is not wrong. The label is a published rule applied to every bill. It says nothing about intent."]
          : []
      }
      chips={
        n ? (
          <>
            {data.estimateClaims.length > 0 && <Src ids={data.estimateClaims} label="CBO PER-SECTION ESTIMATE" />}
            <RuleChip bundle={b} id="buried-v1" />
          </>
        ) : (
          <RuleChip bundle={b} id="buried-v1" />
        )
      }
      notes={
        n > 0 && (
          <Note title="QUIET IS NOT WRONG">
            The label is a published rule applied to every bill: big stakes, little coverage, and added late or
            off-topic. It says nothing about intent.
          </Note>
        )
      }
      ledger={{
        label: n ? `Open the ${n} in the ledger` : "Open the ledger",
        tag: "X-RAY",
        href: billHref(b.bill.id),
      }}
    >
      {n > 0 && (
        <>
          <div className="q-axis" aria-hidden="true">
            <span>← CUTS DEFICIT</span>
            <span>ADDS TO DEFICIT →</span>
          </div>
          <Cap>1 row = 1 section · bar = CBO 10-year change · LDA = lobbying reports naming the section</Cap>
          <ul className="q-rows">
            {data.rows.map((row, i) => (
              <Row key={row.v.s.id} m={m} row={row} i={i} scale={data.scale} />
            ))}
          </ul>
          {data.rows.some((r) => r.evenSplit) && (
            <p className="small">
              <InferenceTag small /> ~ marks an even share of one CBO line that covers several sections; CBO did not
              split it.
            </p>
          )}
        </>
      )}
      {!n && near && (
        <>
          <Cap>The section closest to the rule</Cap>
          <ul className="q-rows">
            <Row
              m={m}
              row={{ v: near, musd: near.dollarsMusd, evenSplit: near.figure?.split === "even_split" }}
              i={0}
              scale={Math.max(1, Math.abs(near.dollarsMusd ?? 1))}
            />
          </ul>
        </>
      )}
    </ChapterPage>
  );
}
