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

/** What hovering a node shows: one line, so the ties it lights up stay in view. */
export function Hover({ id, m, sigma, anchorRef }: Omit<Props, "pinned">) {
  const ref = useRef<HTMLDivElement>(null);

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
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const ox = canvas.left - base.left;
      const oy = canvas.top - base.top;
      let x = ox + p.x + r + 10;
      if (x + w > base.width - 8) x = ox + p.x - r - 10 - w;
      el.style.left = `${Math.max(8, x)}px`;
      el.style.top = `${Math.min(Math.max(8, oy + p.y - h / 2), base.height - h - 8)}px`;
    };
    anchorRef.current = place;
    place();
    return () => {
      if (anchorRef.current === place) anchorRef.current = null;
    };
  }, [id, sigma, anchorRef]);

  const t = headline(id, m);
  return (
    <div ref={ref} className="hover" role="tooltip">
      <Glyph id={id} m={m} />
      <b>{t.title}</b>
      <span>{t.lead}</span>
    </div>
  );
}

/** The pinned node's card, docked beside the map (a sheet on phones): the finding first, then the evidence. */
export function Detail({ id, m }: { id: string; m: BillModel }) {
  const { pin } = useFocus();
  const t = headline(id, m);
  return (
    <aside className="detail-panel" aria-label="Details">
      <div className="dp-top">
        <span className="cap">Selected</span>
        <button type="button" className="close" aria-label="Clear the selection" onClick={() => pin(null)}>
          ×
        </button>
      </div>
      <h3>
        <Glyph id={id} m={m} />
        {t.title}
      </h3>
      <p className="lead">{t.lead}</p>
      <TipBody id={id} m={m} />
    </aside>
  );
}

function headline(id: string, m: BillModel): { title: string; lead: string } {
  const { b } = m;
  if (id === m.billNode) {
    const lobbied = m.actors.filter((a) => a.lobbied.length).length;
    return {
      title: `${b.bill.shortTitle ?? b.bill.display} · ${b.bill.display}`,
      lead: `${lobbied} lobbying clients named it.`,
    };
  }
  if (id.startsWith("section:")) {
    const v = m.sectionById.get(id.slice(8));
    if (!v) return { title: "", lead: "" };
    return {
      title: `${m.secLabel(v)} ${v.s.heading}`,
      lead:
        v.kind === "headline"
          ? "Among the most covered sections in the news."
          : v.kind === "buried"
            ? "Big stakes, little news, added late or off-topic."
            : `Added in ${v.stageName.replace(/ \(.*\)$/, "")}.`,
    };
  }
  const actor = m.actorById.get(id);
  if (actor) {
    const parts = [
      actor.reports ? `${count(actor.reports, "lobbying report")}` : "No lobbying on this bill",
      actor.traders.size ? `${count(actor.traders.size, "member")} traded its stock` : "",
    ].filter(Boolean);
    return { title: nice(actor.label), lead: `${parts.join(", ")}.` };
  }
  const v = m.memberById.get(id);
  if (!v) return { title: "", lead: "" };
  const parts = [
    v.tradeCount ? `${count(v.tradeCount, "trade")} in tied stock` : "No tied-stock trades found",
    v.fundedUsd > 0 ? `${usd(v.fundedUsd)} PAC money from tied groups` : "",
  ].filter(Boolean);
  return { title: v.node.label.replace(/\s*\(.*\)$/, ""), lead: `${parts.join(", ")}.` };
}

/** The same glyphs the key draws: square = company or client, circle = member, filled = voted yea, hollow = not. */
export function Glyph({ id, m }: { id: string; m: BillModel }) {
  const actor = m.actorById.get(id);
  const member = m.memberById.get(id);
  let shape: React.ReactNode = <circle cx="7" cy="7" r="4.5" fill="var(--violet)" opacity="0.5" />;
  if (id === m.billNode)
    shape = <circle cx="7" cy="7" r="5" fill="var(--seal)" stroke="var(--red)" strokeWidth="1.4" />;
  else if (actor) {
    const filled = actor.kind === "company";
    const props = {
      fill: filled ? "var(--violet)" : "none",
      stroke: "var(--violet)",
      strokeWidth: 1.6,
    };
    shape =
      actor.kind === "pac" ? (
        <path d="M7 1.5 12.5 7 7 12.5 1.5 7Z" {...props} />
      ) : (
        <rect x="2.5" y="2.5" width="9" height="9" rx="1.6" {...props} />
      );
  } else if (member) {
    const yea = member.vote?.props.vote === "Yea";
    shape = (
      <circle
        cx="7"
        cy="7"
        r="4.5"
        fill={yea ? "var(--violet)" : "none"}
        stroke={member.sponsor ? "var(--gold)" : "var(--violet)"}
        strokeWidth="1.6"
      />
    );
  }
  return (
    <svg className="glyph" viewBox="0 0 14 14" aria-hidden="true">
      {shape}
    </svg>
  );
}

function TipBody({ id, m }: { id: string; m: BillModel }) {
  const { b } = m;
  if (id === m.billNode) {
    const lobbied = m.actors.filter((a) => a.lobbied.length).length;
    return (
      <>
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
        <div className="k">
          {actor.ticker && <span className="tk">{actor.ticker} · </span>}
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
