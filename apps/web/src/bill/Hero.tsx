import type { BundleIndex } from "@antibody/core";
import { answers, introLine, timeline } from "../lib/derive.ts";
import { day } from "../lib/format.ts";
import type { BillModel } from "../lib/model.ts";
import { Sources } from "../ui/claims.tsx";

export const jump = (id: string) => (e: React.MouseEvent) => {
  e.preventDefault();
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  history.replaceState(null, "", `${location.pathname}${location.search}#${id}`);
};

export function Hero({ m, entry }: { m: BillModel; entry?: BundleIndex["bills"][number] }) {
  const { b } = m;
  const steps = timeline(m);
  const kicker = `${b.bill.display}, ${b.bill.congress}th Congress`;
  return (
    <section className="wrap bhero">
      <div className="bhero-copy">
        <p className="kicker">
          <span>{kicker}</span>
          <span className="kicker-phone">
            {b.bill.lawOn ? `${b.bill.display}, signed ${day(b.bill.lawOn)}` : kicker}
          </span>
        </p>
        <h1>{b.bill.shortTitle ?? b.bill.title}</h1>
        <p className="lead">{introLine(m)}</p>
        <p className="bmeta">
          {b.bill.shortTitle && <>{b.bill.title.replace(/\.+$/, "")}. </>}
          {m.sponsor &&
            (b.bill.vehicle ? (
              <>
                Vehicle bill introduced by {m.sponsor.label}. {b.bill.vehicle}{" "}
              </>
            ) : (
              <>Sponsor {m.sponsor.label}. </>
            ))}
          {b.bill.claims.length ? (
            <Sources ids={b.bill.claims} />
          ) : (
            <a className="src" href={b.bill.billstatusUrl} target="_blank" rel="noopener">
              BILLSTATUS
            </a>
          )}
        </p>
        {entry?.origin === "watcher" && (
          <p className="watched">
            <b>Added by the daily watch{entry.addedOn ? ` on ${day(entry.addedOn)}` : ""}.</b> {entry.note}
          </p>
        )}
      </div>
      <ol className="track" aria-label="How the bill moved">
        {steps.map((s) => (
          <li key={s.label} className={s.signed ? "signed" : ""}>
            <b>{s.label}</b>
            <span>{s.detail}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

const MARK = { loud: "iris", quiet: "flare", money: "money", trade: "trade" } as const;

export function Answers({ m }: { m: BillModel }) {
  return (
    <section className="wrap answers" aria-label="Four answers">
      <div className="answers-g">
        {answers(m).map((a) => (
          <article key={a.label} className={`ans ${a.tone}`}>
            <h2>
              <i className={`mk ${MARK[a.tone]}`} />
              {a.label}
            </h2>
            <p className="big num">{a.big}</p>
            <p className="what">{a.text}</p>
            <a className="go" href={`#${a.target}`} onClick={jump(a.target)}>
              {a.link}
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}
