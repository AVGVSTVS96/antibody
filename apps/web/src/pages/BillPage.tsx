import type { Bundle, Claim } from "@antibody/core";
import { congressGovUrl, parseBillId } from "@antibody/core/ids";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import {
  BenefitsCard,
  BillCard,
  BuriedCard,
  HeadlineCard,
  LobbyCard,
  MembersCard,
  MissingCard,
  Story,
} from "../bill/cards.tsx";
import { type Focus, FocusCtx } from "../bill/focus.ts";
import { buildGraph } from "../bill/graph.ts";
import { Stage } from "../bill/Stage.tsx";
import { loadBundle, loadClaims, loadIndex } from "../lib/data.ts";
import { buildModel } from "../lib/model.ts";
import { billHref, navigate, onLink, type Route, type View } from "../lib/router.ts";
import { ClaimProvider } from "../ui/claims.tsx";
import { Search } from "../ui/icons.tsx";
import { Top } from "../ui/Top.tsx";

type BillRoute = Extract<Route, { page: "bill" }>;

export default function BillPage({ route }: { route: BillRoute }) {
  let id = route.id;
  try {
    id = parseBillId(route.id);
  } catch {}
  const bundle = use(loadBundle(id));
  if (!bundle) return <NotFound id={id} />;
  return <BillView b={bundle} route={route} />;
}

function BillView({ b, route }: { b: Bundle; route: BillRoute }) {
  const [claims, setClaims] = useState<Record<string, Claim> | null>(Object.keys(b.claims).length ? b.claims : null);
  useEffect(() => {
    if (claims) return;
    let live = true;
    loadClaims(b.bill.id)
      .then((c) => live && setClaims(c ?? {}))
      .catch(() => live && setClaims({}));
    return () => {
      live = false;
    };
  }, [b.bill.id, claims]);
  const m = useMemo(() => buildModel(b), [b]);
  const built = useMemo(() => buildGraph(m), [m]);
  const [hover, setHover] = useState<string | null>(null);
  const pinned = route.focus;

  useEffect(() => {
    const name = b.bill.shortTitle ?? b.bill.title;
    document.title = `${name} (${b.bill.display}) · antibody`;
  }, [b]);

  const pin = useCallback(
    (id: string | null) => navigate(billHref(b.bill.id, route.view, id), { replace: true }),
    [b.bill.id, route.view],
  );
  const setView = useCallback((v: View) => navigate(billHref(b.bill.id, v, null), { replace: true }), [b.bill.id]);
  const focus = useMemo<Focus>(() => ({ hover, pinned, setHover, pin }), [hover, pinned, pin]);

  return (
    <ClaimProvider claims={claims}>
      <FocusCtx.Provider value={focus}>
        <Top crumb={b.bill.shortTitle ?? b.bill.display} right={b.bill.law ?? b.bill.display} />
        <div className="app">
          <Story m={m} />
          <aside className="side" aria-label="Findings">
            <BillCard m={m} />
            <HeadlineCard m={m} />
            <BuriedCard m={m} />
            <LobbyCard m={m} />
            <BenefitsCard m={m} />
            <MembersCard m={m} />
            <MissingCard m={m} />
          </aside>
          <Stage m={m} built={built} view={route.view} setView={setView} />
        </div>
        <footer className="foot">
          Every line links its public source. Dashed lines and <span className="pill inf">inference</span> tags are
          inferences, kept apart from facts; hover a chip to see what a claim rests on. Same rules, colors and wording
          for every party. Bundle built {b.generatedAt.slice(0, 10)}.
        </footer>
      </FocusCtx.Provider>
    </ClaimProvider>
  );
}

function NotFound({ id }: { id: string }) {
  const index = use(loadIndex());
  const [q, setQ] = useState("");
  useEffect(() => {
    document.title = "Not x-rayed yet · antibody";
  }, []);
  let url: string | null = null;
  try {
    url = congressGovUrl(parseBillId(id));
  } catch {}
  const needle = q.trim().toLowerCase();
  const hits = needle
    ? index.bills
        .filter((b) => [b.id, b.display, b.title, b.shortTitle ?? ""].some((x) => x.toLowerCase().includes(needle)))
        .slice(0, 6)
    : [];
  const featured = index.bills.filter((b) => ["119-s-1582", "117-hr-5376", "119-hr-1"].includes(b.id));
  return (
    <>
      <Top />
      <main className="home">
        <section className="hero">
          <h1>We haven’t x‑rayed this bill yet.</h1>
          <p>
            <code>{id}</code> isn’t one of the {index.bills.length} bills here so far.
            {url && (
              <>
                {" "}
                You can{" "}
                <a href={url} target="_blank" rel="noopener">
                  read it on congress.gov ↗
                </a>
                , or try another bill.
              </>
            )}
          </p>
          <form className="search" onSubmit={(e) => e.preventDefault()}>
            <Search />
            <label className="sr" htmlFor="nf">
              Find a bill
            </label>
            <input
              id="nf"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="S.1582, H.R. 1, GENIUS"
              autoComplete="off"
              spellCheck={false}
            />
          </form>
          {hits.length > 0 && (
            <ul className="nfhits">
              {hits.map((b) => (
                <li key={b.id}>
                  <a href={billHref(b.id)} onClick={onLink}>
                    <b className="mono">{b.display}</b> {b.shortTitle ?? b.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="section-h">
          <span className="cap">Bills to start with</span>
        </div>
        <div className="grid">
          {featured.map((b) => (
            <a key={b.id} className="nfcard" href={billHref(b.id)} onClick={onLink}>
              <span className="mono cap">{b.display}</span>
              <b>{b.shortTitle ?? b.title}</b>
            </a>
          ))}
        </div>
      </main>
    </>
  );
}
