import { type Era, eraLine, eras } from "../lib/derive.ts";
import { count, day } from "../lib/format.ts";
import type { BillModel } from "../lib/model.ts";
import { Section } from "./Section.tsx";

export function Built({ m }: { m: BillModel }) {
  const groups = eras(m);
  const final = m.sections.filter((v) => v.s.inFinal);
  const dropped = m.sections.length - final.length;
  const unknown = !!m.b.bill.lateUnavailable;
  const early = groups.filter((g) => !g.late);
  const late = groups.filter((g) => g.late);
  const lateN = late.reduce((a, g) => a + g.sections.length, 0);
  const earlyN = early.reduce((a, g) => a + g.sections.length, 0);
  if (!final.length) return null;
  return (
    <Section id="built" title="How the law was built">
      <p className="lead narrow">
        Every square is one of the {final.length.toLocaleString("en-US")} sections that{" "}
        {m.b.bill.law ? "became law" : "are in the latest text"}, grouped by the version of the bill where it first
        appears.
        {!unknown &&
          lateN > 0 &&
          ` ${lateN > final.length / 2 ? "Over half" : `${count(lateN, "section")}`} arrived after the first text.`}
      </p>
      {unknown ? (
        <div className="eras">
          <div className="era-band solo">
            <b>By version</b>
          </div>
          <div className="era-g solo">
            {groups.map((g) => (
              <EraBlock key={g.v.code} g={g} />
            ))}
          </div>
          <p className="callout">Late flag unavailable: {m.b.bill.lateUnavailable}</p>
        </div>
      ) : (
        <div className="eras">
          <div
            className="era-bands"
            style={{ gridTemplateColumns: `${Math.max(1, early.length)}fr ${Math.max(1, late.length)}fr` }}
          >
            <div className="era-band">
              <b>There from the start: {earlyN}</b>
            </div>
            {late.length > 0 && (
              <div className="era-band dark">
                <b>
                  Added late: {lateN}
                  {lateN > final.length / 2 ? `, more than half the law` : ""}
                </b>
              </div>
            )}
          </div>
          <div
            className="era-g"
            style={{ gridTemplateColumns: `repeat(${Math.max(1, groups.length)}, minmax(0, 1fr))` }}
          >
            {[...early, ...late].map((g) => (
              <EraBlock key={g.v.code} g={g} />
            ))}
          </div>
        </div>
      )}
      {dropped > 0 && (
        <p className="foot-note">
          Another {dropped.toLocaleString("en-US")} sections from earlier versions were dropped along the way and aren’t
          shown.
        </p>
      )}
    </Section>
  );
}

const cellFor = (n: number) => (n > 1200 ? 4 : n > 600 ? 6 : n > 240 ? 10 : 18);

function EraBlock({ g }: { g: Era }) {
  return (
    <div className="era" style={g.sections.length > 240 ? { gridColumn: "1 / -1" } : undefined}>
      <p className="era-d num">{g.v.date ? day(g.v.date) : ""}</p>
      <h3>{g.title}</h3>
      <p className="era-n">{eraLine(g)}</p>
      <ul
        className="waffle"
        aria-label={`${g.sections.length} sections`}
        style={
          {
            "--cell": `${cellFor(g.sections.length)}px`,
            "--gap": `${g.sections.length > 600 ? 2 : g.sections.length > 240 ? 3 : 8}px`,
          } as React.CSSProperties
        }
      >
        {g.sections.map((v) => (
          <li
            key={v.s.id}
            className={v.kind === "buried" ? "b" : v.kind === "headline" ? "h" : ""}
            title={`§${v.s.num} ${v.s.heading}`}
          />
        ))}
      </ul>
    </div>
  );
}
