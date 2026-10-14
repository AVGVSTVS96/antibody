import { use, useEffect, useMemo } from "react";
import { loadIndex } from "../lib/data.ts";
import { count } from "../lib/format.ts";
import { useMedia } from "../lib/media.ts";
import { closestToQuiet } from "../lib/model.ts";
import { buildTape, type Tape as TapeData, type TapeRow } from "../lib/tape.ts";
import { useModel } from "../ui/BillGate.tsx";
import { Note, Section } from "../ui/primitives.tsx";
import { Tape } from "../ui/Tape.tsx";
import { contrast, leanOf, nearly, passages } from "../xray/derive.ts";
import { Chart, quietNote } from "../xray/Gap.tsx";
import { Head } from "../xray/Head.tsx";
import { ReadIt } from "../xray/ReadIt.tsx";
import { useReader } from "../xray/reader.ts";
import { Pair, Who } from "../xray/Side.tsx";
import { hover, reading } from "../xray/store.ts";
import "../xray/xray.css";

function LiveTape({ tape, onSelect, phone }: { tape: TapeData; onSelect: (r: TapeRow) => void; phone: boolean }) {
  const lit = hover.use();
  const here = reading.use();
  const highlight = useMemo(() => (lit ? new Set([lit]) : undefined), [lit]);
  return (
    <Tape
      pinned
      tape={tape}
      onSelect={onSelect}
      current={here ?? undefined}
      currentLabel={phone ? "You are here" : "You are reading this"}
      highlight={highlight}
      caption={
        phone
          ? "THE TAPE · STAYS PINNED"
          : "THE TAPE · STAYS PINNED WHILE YOU READ · CLICK A MARK TO JUMP TO ITS SECTION"
      }
    />
  );
}

function Legend({ tape }: { tape: TapeData }) {
  const loud = tape.rows.filter((r) => r.kind === "headline");
  const cuts = loud.some((r) => (r.musd ?? 0) < 0);
  const adds = loud.some((r) => (r.musd ?? 0) >= 0);
  const keys = [
    ...(tape.flat && loud.length ? [{ mark: "loud", text: "LOUD", cut: false }] : []),
    ...(!tape.flat && adds ? [{ mark: "loud", text: "LOUD · ADDS", cut: false }] : []),
    ...(!tape.flat && cuts ? [{ mark: "loud", text: "LOUD · CUTS", cut: true }] : []),
    ...(tape.quiet ? [{ mark: "quiet", text: "QUIET AND COSTLY", cut: false }] : []),
    ...(tape.rows.some((r) => r.kind === "other") ? [{ mark: "other", text: "OTHER", cut: false }] : []),
    ...(tape.evenSplit > 0 ? [{ mark: "split", text: "DASHED RING = EVEN SPLIT (INFERENCE)", cut: false }] : []),
  ];
  return (
    <ul className="x-legend">
      {keys.map((k) => (
        <li key={k.text}>
          <i className="x-dot-key" data-mark={k.mark} data-cut={k.cut || undefined} />
          {k.text}
        </li>
      ))}
    </ul>
  );
}

export default function XrayPage() {
  const m = useModel();
  const { bill } = m.b;
  const tape = useMemo(() => buildTape(m), [m]);
  const entry = use(loadIndex()).bills.find((b) => b.id === bill.id);
  const reader = useReader(tape, bill.id);
  const phone = useMedia("(max-width: 679px)");
  const passes = useMemo(() => passages(m.b.votes), [m]);
  const pair = useMemo(() => contrast(tape.rows), [tape]);
  const lean = useMemo(() => leanOf(m.b), [m]);
  const ctx = useMemo(() => ({ m, tape, firstPass: passes[0] }), [m, tape, passes]);
  useEffect(
    () => () => {
      hover.set(null);
      reading.set(null);
    },
    [],
  );

  const test = entry?.stats?.buriedTest;
  const why =
    [
      test?.why,
      test && !test.dollarsMeasured && "CBO gave no per-section dollars, so only lobbying can show big stakes",
    ]
      .filter(Boolean)
      .join("; ") || null;
  const figured = tape.rows.filter((r) => r.musd != null).length;
  const first = tape.rows.find((r) => r.view.figure)?.view;
  const period = first?.s.dollars.find(
    (d) => d.estimateId === first.figure!.estimateId && d.baseline === "current-law",
  )?.period;
  const unmeasured = tape.rows.filter((r) => r.articles == null).length;
  const note = quietNote(tape);
  const closest = closestToQuiet(m);

  return (
    <div className="xray">
      <Head m={m} passes={passes} />
      <LiveTape tape={tape} onSelect={(r) => reader.go(r.id)} phone={phone} />
      <Section
        className="x-gap"
        kicker={`THE GAP · EVERY DOT IS ONE SECTION OF THE ${bill.law ? "ENACTED LAW" : "FINAL TEXT"} · ${
          tape.flat ? "CBO GAVE NO PER-SECTION DOLLARS" : `${figured.toLocaleString("en-US")} WITH A CBO LINE`
        }`}
        title={tape.flat ? "Coverage, section by section." : "Cost against coverage, section by section."}
        aside={<Legend tape={tape} />}
      >
        <div className="x-gap-grid">
          <div className="x-gap-main">
            {tape.flat && (
              <Note tone="dashed" title="NO COST AXIS">
                CBO gave no dollar figure to any section of this bill, so the dots cannot be placed by cost. They are
                placed by news matches alone.
              </Note>
            )}
            <Chart tape={tape} period={period ?? null} onGo={reader.go} />
            {note && (
              <p className="x-chart-note">
                <span className="tag" data-tone="quiet">
                  {tape.quiet} QUIET AND COSTLY
                </span>{" "}
                {note}
              </p>
            )}
            {unmeasured > 0 && (
              <p className="x-chart-note">
                {count(unmeasured, "section")} not measured for news {unmeasured === 1 ? "is" : "are"} not drawn.
              </p>
            )}
          </div>
          <div className="x-gap-side">
            {pair ? (
              <Pair pair={pair} read={tape.read} go={reader.go} />
            ) : (
              <Note tone="dashed" title="SAME COST, TWO CONVERSATIONS">
                {test && !test.tested
                  ? `The quiet-and-costly rule could not be tested on this bill: ${test.why}.`
                  : tape.quiet
                    ? "No quiet-and-costly section has a headline section of similar cost on an exact CBO line, so there is no pair to show."
                    : `No section met the quiet-and-costly rule.${closest ? ` ${nearly(m, closest)}` : ""}`}
              </Note>
            )}
            <Who lean={lean} version={m.b.attention.outletListVersion} />
          </div>
        </div>
      </Section>
      <Section className="x-readband">
        <ReadIt r={reader} ctx={ctx} pair={pair} why={why} name={bill.id} />
      </Section>
    </div>
  );
}
