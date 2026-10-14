import { count, RULES_URL } from "../lib/format.ts";
import type { TapeRow } from "../lib/tape.ts";
import { Src } from "../ui/receipt.tsx";
import { type Contrast, LEAN, type Lean, OUTLETS_URL, signed, sum } from "./derive.ts";

function Card({
  row,
  read,
  tone,
  go,
}: {
  row: TapeRow;
  read: number;
  tone: "loud" | "quiet";
  go: (id: string) => void;
}) {
  return (
    <button type="button" className="x-pair-card" data-tone={tone} onClick={() => go(row.id)}>
      <span className="x-mono">
        {row.label} · {tone === "quiet" ? "QUIET AND COSTLY" : "HEADLINE"}
      </span>
      <b>{row.heading}</b>
      <strong>{signed(row.musd!)}</strong>
      <span className="x-mono x-bold">
        {count(row.articles ?? 0, "ARTICLE")} OF {read.toLocaleString("en-US")} READ
      </span>
    </button>
  );
}

export function Pair({ pair, read, go }: { pair: Contrast; read: number; go: (id: string) => void }) {
  return (
    <section className="x-pair" aria-labelledby="x-pair-h">
      <h3 id="x-pair-h">SAME COST, TWO CONVERSATIONS</h3>
      <div>
        <Card row={pair.loud} read={read} tone="loud" go={go} />
        <Card row={pair.quiet} read={read} tone="quiet" go={go} />
      </div>
      <p>
        Picked by one rule for every bill: the headline and the quiet-and-costly section whose CBO figures are closest
        on a log scale, both exact lines (not an even split), both adding or both cutting.
      </p>
    </section>
  );
}

function Bar({ by, label }: { by: Lean["sections"]; label: string }) {
  const total = sum(by);
  return (
    <figure className="x-lean-fig">
      <figcaption>{label}</figcaption>
      <div
        className="x-lean-bar"
        role="img"
        aria-label={`${label}: ${LEAN.map(([g, name]) => `${name} ${by[g]}`).join(", ")}`}
      >
        {LEAN.map(([g], i) => (
          <i key={g} style={{ flexGrow: by[g], background: `var(--lean-${i + 1})` }} hidden={!by[g]} />
        ))}
        {!total && <i style={{ flexGrow: 1 }} />}
      </div>
      <ul>
        {LEAN.map(([g, name]) => (
          <li key={g}>
            {name.toUpperCase()} {by[g]}
          </li>
        ))}
      </ul>
    </figure>
  );
}

export function Who({ lean, version }: { lean: Lean; version: string | null }) {
  return (
    <section className="x-lean" aria-labelledby="x-lean-h">
      <h3 id="x-lean-h">WHO COVERED IT · BY OUTLET LEAN</h3>
      <Bar by={lean.sections} label={`${sum(lean.sections).toLocaleString("en-US")} matches to sections of the text`} />
      <Bar
        by={lean.general}
        label={`${sum(lean.general).toLocaleString("en-US")} articles about the bill as a whole`}
      />
      <p>
        Loudness is the total, whichever side wrote it. Grays, not party colors: the scale does not take a side.
        {lean.tradeLegal > 0 &&
          ` Trade and legal press (${count(lean.tradeLegal, "match", "matches")}) is counted apart.`}{" "}
        <a href={OUTLETS_URL} target="_blank" rel="noopener noreferrer">
          Outlet list{version ? ` ${version}` : ""} ↗
        </a>{" "}
        <a href={`${RULES_URL}#attention-v1`} target="_blank" rel="noopener noreferrer">
          How matches are counted ↗
        </a>
      </p>
      <p className="x-chips">
        {lean.sectionClaims.length > 0 && <Src ids={lean.sectionClaims} label="SECTION MATCHES" />}
        {lean.generalClaim && <Src ids={lean.generalClaim} label="WHOLE-BILL ARTICLES" />}
      </p>
    </section>
  );
}
