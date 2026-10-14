import { type RefObject, useLayoutEffect, useRef } from "react";
import { count, day, musd, nice, rank, usd } from "../lib/format.ts";
import type { BillModel } from "../lib/model.ts";
import { Inf, Sources, Src } from "../ui/claims.tsx";
import { useFocus } from "./focus.ts";
import type { Renderer } from "./graph.ts";

interface Props {
  id: string;
  m: BillModel;
  sigma: Renderer;
  pinned: boolean;
  anchorRef: RefObject<(() => void) | null>;
}

/** The node's card on the map. Hover shows it; click pins it so its source chips can be reached. */
export function Tip({ id, m, sigma, pinned, anchorRef }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { pin } = useFocus();

  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const g = sigma.getGraph();
      if (!g.hasNode(id)) return;
      const a = g.getNodeAttributes(id);
      const p = sigma.graphToViewport({ x: a.x, y: a.y });
      const r = sigma.scaleSize(a.size) * sigma.getGraphToViewportRatio();
      const host = el.offsetParent as HTMLElement | null;
      const canvas = sigma.getContainer().getBoundingClientRect();
      const base = host?.getBoundingClientRect() ?? canvas;
      const W = base.width;
      const H = base.height;
      const ox = canvas.left - base.left;
      const oy = canvas.top - base.top;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let x = ox + p.x + r + 12;
      if (x + w > W - 12) x = ox + p.x - r - 12 - w;
      if (x < 12) x = Math.max(12, (W - w) / 2);
      const y = Math.min(Math.max(12, oy + p.y - 24), H - h - 64);
      el.style.left = `${x}px`;
      el.style.top = `${Math.max(12, y)}px`;
    };
    anchorRef.current = place;
    place();
    return () => {
      if (anchorRef.current === place) anchorRef.current = null;
    };
  }, [id, sigma, anchorRef]);

  return (
    <div
      ref={ref}
      className="tip"
      role="dialog"
      aria-label="Details"
      style={{ pointerEvents: pinned ? "auto" : "none" }}
    >
      {pinned && (
        <button type="button" className="close" aria-label="Close" onClick={() => pin(null)}>
          ×
        </button>
      )}
      <TipBody id={id} m={m} />
      {!pinned && (
        <div className="cap dim" style={{ marginTop: 8 }}>
          click to pin and open sources
        </div>
      )}
    </div>
  );
}

function TipBody({ id, m }: { id: string; m: BillModel }) {
  const { b } = m;
  if (id === m.billNode) {
    const lobbied = m.actors.filter((a) => a.lobbied.length).length;
    return (
      <>
        <h3>
          {b.bill.shortTitle ?? b.bill.display} · {b.bill.display}
        </h3>
        <div className="k">
          {b.bill.law ?? "Not law"}
          {b.bill.lawOn ? ` · signed ${day(b.bill.lawOn)}` : ""}
        </div>
        <div className="ln">
          {count(m.sections.filter((v) => v.s.inFinal).length, "section")} in the final text. {lobbied} lobbying clients
          named it in an LD-2.
        </div>
        <Sources ids={b.bill.claims} />
      </>
    );
  }
  if (id.startsWith("section:")) {
    const v = m.sectionById.get(id.slice(8));
    if (!v) return null;
    const s = v.s;
    return (
      <>
        <h3>
          {m.secLabel(v)} {s.heading}
        </h3>
        <div className="k">
          {v.kind === "headline" && <span className="pill headline">headline</span>}
          {v.kind === "buried" && (
            <>
              <span className="pill buried">buried candidate</span> <Inf />
            </>
          )}{" "}
          {s.words.toLocaleString("en-US")} words{!s.inFinal && " · not in the final text"}
        </div>
        <div className="ln">
          Added: <b>{v.stageName}</b>
          {s.changedIn.length
            ? ` · changed in ${s.changedIn.length} later version${s.changedIn.length > 1 ? "s" : ""}`
            : " · unchanged since"}
        </div>
        <div className="ln">
          News rank:{" "}
          {s.attention?.pct == null ? (
            <span className="miss">not scored</span>
          ) : (
            <>
              {rank(s.attention.pct)} of 100 · {count(s.attention.hits, "article")}
            </>
          )}
        </div>
        <div className="ln">
          CBO $:{" "}
          {v.dollarsMusd == null ? (
            <span className="miss">{m.perSectionDollars ? "none for this section" : "whole bill only"}</span>
          ) : (
            <>
              {musd(v.dollarsMusd)} deficit {s.dollars.some((d) => d.split === "even_split") && <Inf />}
            </>
          )}
        </div>
        {v.lobbied > 0 && <div className="ln">Named in {count(v.lobbied, "lobbying report")} by section number</div>}
        <Sources ids={[...s.claims, s.attention?.claim, s.score?.claim, ...s.dollars.map((d) => d.claim)]} />
      </>
    );
  }
  const actor = m.actorById.get(id);
  if (actor) {
    const lobby = actor.lobbied[0];
    const traders = [...actor.traders]
      .map((t) => m.memberById.get(t)?.node.label.replace(/\s*\(.*\)$/, ""))
      .filter(Boolean);
    return (
      <>
        <h3>
          {nice(actor.label)} {actor.ticker && <span className="tk">{actor.ticker}</span>}
        </h3>
        <div className="k">
          {actor.reports ? `${count(actor.reports, "LD-2 report")} name the bill` : "no lobbying on the bill"}
          {actor.spendUsd != null && ` · ${usd(actor.spendUsd)} on those quarters`}
        </div>
        {lobby?.props.issueQuote && (
          <div className="quote">
            “{lobby.props.issueQuote.length > 200 ? `${lobby.props.issueQuote.slice(0, 200)}…` : lobby.props.issueQuote}
            ”
          </div>
        )}
        <div className="ln">
          {actor.kind === "company" ? (
            actor.resolutions.length ? (
              <>
                SEC company, matched from its filings <Inf />
              </>
            ) : (
              "SEC company"
            )
          ) : actor.kind === "pac" ? (
            "PAC with no matched company"
          ) : (
            "No public parent company"
          )}
        </div>
        {traders.length > 0 && (
          <div className="ln">
            {traders.length} members traded its stock: {traders.slice(0, 4).join(", ")}
            {traders.length > 4 ? "…" : ""}
          </div>
        )}
        {actor.pacUsd > 0 && <div className="ln">Its PAC gave {usd(actor.pacUsd)} to members on the map</div>}
        <Sources
          ids={[...actor.lobbied.flatMap((e) => e.claims), ...actor.node.claims, ...(actor.benefits?.claims ?? [])]}
          max={4}
        />
      </>
    );
  }
  const v = m.memberById.get(id);
  if (!v) return null;
  const p = v.node.props;
  const last = v.trades.flatMap((t) => t.props.events).sort((x, y) => y.date.localeCompare(x.date))[0];
  const roll = v.vote ? b.votes.find((r) => r.id === v.vote!.props.rollId) : null;
  return (
    <>
      <h3>{v.node.label.replace(/\s*\(.*\)$/, "")}</h3>
      <div className="k">
        {p.party}-{p.state}
        {p.district ? `-${p.district}` : ""} · {p.chamber}
        {v.sponsor ? " · sponsor" : ""}
        {v.committees.length ? ` · ${v.committees.map((c) => c.committee.label).join(", ")}` : ""}
      </div>
      <div className="ln">
        {roll ? (
          <>
            Voted <b>{v.vote!.props.vote}</b> on {roll.question.toLowerCase()} <Src id={v.vote!.claims[0]!} />
          </>
        ) : (
          "No recorded vote on this bill"
        )}
      </div>
      <div className="ln">
        {v.tradeCount
          ? `${count(v.tradeCount, "trade")} in tied companies’ stock`
          : "No trades in tied companies found"}
        {p.paperFilingsUnread && " · paper filings not yet read"}
      </div>
      {last && (
        <div className="ln">
          Latest: {last.type.replace("_", " ")} {last.ticker} {last.amount} on {day(last.date)}
          {last.owner !== "self" ? ` (owner: ${last.owner})` : ""} <Src id={last.claim} />
        </div>
      )}
      <div className="ln">
        PAC money from tied organizations: <b>{usd(v.fundedUsd)}</b> {v.fundedUsd > 0 && <Inf />}
      </div>
      <Sources ids={[...v.node.claims, ...v.funded.slice(0, 2).flatMap((f) => f.edge.claims)]} />
    </>
  );
}
