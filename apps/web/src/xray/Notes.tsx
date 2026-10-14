import type { ArticleList } from "@antibody/core";
import { useEffect, useState } from "react";
import { loadArticles } from "../lib/data.ts";
import { count, day, RULES_URL } from "../lib/format.ts";
import type { BillModel } from "../lib/model.ts";
import { onLink, sectionHref } from "../lib/router.ts";
import type { Tape, TapeRow } from "../lib/tape.ts";
import { InferenceTag } from "../ui/primitives.tsx";
import { Src, useReceipt } from "../ui/receipt.tsx";
import { LEAN, lobbyingOf, months, OUTLETS_URL, type Passage, seenOf, signed } from "./derive.ts";

export interface Ctx {
  m: BillModel;
  tape: Tape;
  firstPass: Passage | undefined;
}

/** FACT or INFERENCE as the claims themselves say, so a label never promises more than the record. */
function Kind({ ids, note }: { ids: readonly string[]; note?: string }) {
  const { inference: isInference } = useReceipt();
  const inference = ids.some(isInference);
  return inference ? (
    <span className="x-kind">
      <InferenceTag small />
      {note && ` ${note}`}
    </span>
  ) : (
    <span className="x-kind">FACT{note && ` · ${note}`}</span>
  );
}

function Block({ title, kind, children }: { title: string; kind?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="x-note">
      <header>
        <b>{title}</b>
        {kind}
      </header>
      {children}
    </section>
  );
}

function Cost({ row, m }: { row: TapeRow; m: BillModel }) {
  const f = row.view.figure;
  if (!f)
    return (
      <Block title="COST TO THE DEFICIT">
        <p className="x-none">No CBO figure</p>
        <p className="x-fine">
          {m.perSectionDollars
            ? "CBO's per-section table does not list this section."
            : "CBO gave no per-section dollars for this bill: it scored the bill as a whole."}
        </p>
      </Block>
    );
  const period = row.view.s.dollars.find((d) => d.estimateId === f.estimateId && d.baseline === "current-law")?.period;
  return (
    <Block
      title="COST TO THE DEFICIT"
      kind={<Kind ids={f.claims} note={row.evenSplit ? "EVEN SPLIT" : "EXACT LINE"} />}
    >
      <strong className="x-big">{signed(f.musd)}</strong>
      <p className="x-fine">
        {period?.replace("-", "–")} · {f.estimate.baselineLabel} <Src ids={f.claims} label="CBO" />
      </p>
      {row.evenSplit && (
        <p className="x-fine">
          An even share of one CBO line that covers several sections.{" "}
          <a href={`${RULES_URL}#cbo-even-split`} target="_blank" rel="noopener noreferrer">
            The rule ↗
          </a>
        </p>
      )}
    </Block>
  );
}

function Articles({ id, row }: { id: string; row: TapeRow }) {
  const [list, setList] = useState<ArticleList | null | undefined>(undefined);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (on) loadArticles(id).then(setList, () => setList(null));
  }, [on, id]);
  const att = row.view.s.attention!;
  const shown = list ? (list.bySection[row.id] ?? []).map((i) => list.articles[i]!) : att.examples;
  return (
    <>
      <button type="button" className="linkbtn" aria-expanded={on} onClick={() => setOn(!on)}>
        {on ? "HIDE" : "SHOW"} THE {att.hits} ARTICLES {on ? "▴" : "▾"}
      </button>
      {on && list === undefined && <p className="x-fine">Loading the list…</p>}
      {on && list !== undefined && (
        <ol className="x-articles">
          {shown.map((a) => (
            <li key={a.claim}>
              <span className="x-fine">
                {a.outlet} · {a.group.toUpperCase()} · {day(a.date)}
              </span>
              <Src ids={a.claim} label={a.title} />
            </li>
          ))}
          {shown.length < att.hits && (
            <li className="x-fine">
              Showing {shown.length} of {att.hits}: the full list did not load.
            </li>
          )}
        </ol>
      )}
    </>
  );
}

function News({ row, ctx }: { row: TapeRow; ctx: Ctx }) {
  const att = row.view.s.attention;
  if (!att)
    return (
      <Block title="NEWS">
        <p className="x-none">Not measured</p>
        <p className="x-fine">Coverage was not measured for this section.</p>
      </Block>
    );
  const { read } = ctx.tape;
  const groups = LEAN.map(([g], i) => [i + 1, att.hitsByGroup[g] ?? 0] as const).filter(([, n]) => n);
  const window = ctx.m.b.attention.window;
  return (
    <Block title="NEWS" kind={<Kind ids={[att.claim]} note="COUNT" />}>
      <div className="x-meter" role="img" aria-label={`${att.hits} of ${read} articles read matched this section`}>
        {groups.map(([i, n]) => (
          <i key={i} style={{ width: `${(n / read) * 100}%`, background: `var(--lean-${i})` }} />
        ))}
      </div>
      <p className="x-fine x-ink">
        {att.hits} OF {read.toLocaleString("en-US")} ARTICLES READ
        {window && ` · ${months(window).toUpperCase()}`} <Src ids={att.claim} label="COUNT" />{" "}
        <a href={OUTLETS_URL} target="_blank" rel="noopener noreferrer">
          OUTLET LIST ↗
        </a>
      </p>
      {att.tradeLegalHits > 0 && (
        <p className="x-fine">
          Plus {count(att.tradeLegalHits, "trade or legal press match", "trade or legal press matches")}, counted apart.
        </p>
      )}
      {att.hits === 0 && <p className="x-fine">None of the articles we read, which is not the same as no coverage.</p>}
      {att.hits > 0 && <Articles id={ctx.m.b.bill.id} row={row} />}
    </Block>
  );
}

function Seen({ row, ctx }: { row: TapeRow; ctx: Ctx }) {
  const seen = seenOf(ctx.m, row.view, ctx.firstPass);
  const label = (t: (typeof seen.ticks)[number]) =>
    `${t.date ? `${day(t.date).toUpperCase()}\n` : ""}${t.name.toUpperCase()}`;
  const first = seen.ticks.find((t) => t.first);
  const end = seen.ticks.at(-1);
  const labelled = [first, ...[seen.ticks[0], end].filter((t) => t && first && Math.abs(t.x - first.x) > 0.34)].filter(
    (t): t is NonNullable<typeof first> => !!t,
  );
  return (
    <Block title="FIRST SEEN" kind={<Kind ids={seen.claims} note="TEXT DIFF" />}>
      <div className="x-line" role="img" aria-label={`First seen in ${row.view.stageName}`}>
        <i className="x-line-base" />
        {seen.ticks.map((t) => (
          <i
            key={t.code}
            className="x-line-tick"
            data-present={t.present || undefined}
            style={{ left: `${t.x * 100}%` }}
          />
        ))}
        {first && <i className="x-line-dot" data-kind={row.kind} style={{ left: `${first.x * 100}%` }} />}
      </div>
      <div className="x-line-labels">
        {labelled.map((t) => (
          <span
            key={t.code}
            data-first={t.first || undefined}
            data-end={t.x > 0.5 || undefined}
            style={t.x > 0.5 ? { right: `${(1 - t.x) * 100}%` } : { left: `${t.x * 100}%` }}
          >
            {label(t)}
          </span>
        ))}
      </div>
      <p className="x-fine x-ink">
        {seen.inference && <InferenceTag small />} {seen.text} <Src ids={seen.claims} label="VERSIONS" />
      </p>
    </Block>
  );
}

function Distance({ row }: { row: TapeRow }) {
  const score = row.view.s.score;
  const d = score?.components.offTopic;
  return (
    <Block title="DISTANCE FROM THE BILL'S CORE" kind={<InferenceTag />}>
      {d != null ? (
        <>
          <div className="x-dist" role="img" aria-label={`Distance ${d.toFixed(2)} on a scale of 0 to 1`}>
            <i style={{ width: `${d * 100}%` }} />
          </div>
          <p className="x-fine x-ink">
            {d.toFixed(2)} · HOW UNLIKE THE REST OF THE BILL, RANKED 0 TO 1 <Src ids={score!.claim} label="SCORE" />{" "}
            <a href={`${RULES_URL}#buried-v1`} target="_blank" rel="noopener noreferrer">
              HOW ↗
            </a>
          </p>
        </>
      ) : (
        <p className="x-fine">
          {score
            ? "Not counted for this bill: the rule uses distance only in a bill with a single committee title."
            : "This section was not scored."}{" "}
          <a href={`${RULES_URL}#buried-v1`} target="_blank" rel="noopener noreferrer">
            The rule ↗
          </a>
        </p>
      )}
    </Block>
  );
}

function Lobbying({ row, ctx }: { row: TapeRow; ctx: Ctx }) {
  const l = lobbyingOf(ctx.m, row.view);
  const bill = ctx.m.b.bill.id;
  const drawnNote = ctx.m.b.gaps.find((g) => g.text.startsWith("Drawn:"))?.text;
  return (
    <section className="x-note x-lobby">
      <header>
        <b>LOBBYING</b>
        {l.named > 0 && <Kind ids={l.namedClaims.slice(0, 1)} note="LDA.GOV" />}
      </header>
      {l.named ? (
        <>
          <p className="x-lobby-line">
            {count(l.named, "lobbying report")} name it
            <span className="x-sub">
              {l.drawn
                ? `. The ${l.drawn} from ${count(l.clients, "drawn client")} are the ones on the money page.`
                : "; none is from a client drawn here."}
            </span>
          </p>
          {!l.drawn && drawnNote && <p className="x-fine">{drawnNote}</p>}
          <p className="x-fine">
            <Src ids={l.namedClaims} label="REPORTS" />
            {l.drawn > 0 && (
              <>
                {" "}
                <Src ids={l.drawnClaims} label="FROM DRAWN CLIENTS" />
              </>
            )}
          </p>
          <a className="x-follow" href={sectionHref(bill, ctx.m.sectionSlug(row.view))} onClick={onLink}>
            <span>FOLLOW THE MONEY</span>
            <span aria-hidden="true">→</span>
          </a>
        </>
      ) : (
        <p className="x-lobby-line">No lobbying filing names it.</p>
      )}
    </section>
  );
}

export function Notes({ row, ctx }: { row: TapeRow; ctx: Ctx }) {
  return (
    <div className="x-notes">
      <div className="x-notes-pair">
        <Cost row={row} m={ctx.m} />
        <News row={row} ctx={ctx} />
      </div>
      <Seen row={row} ctx={ctx} />
      <Distance row={row} />
      <Lobbying row={row} ctx={ctx} />
    </div>
  );
}
