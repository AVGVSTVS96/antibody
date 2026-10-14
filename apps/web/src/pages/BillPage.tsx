import type { Bundle } from "@antibody/core";
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
  Verdict,
} from "../bill/cards.tsx";
import { type Focus, FocusCtx } from "../bill/focus.ts";
import { buildGraph } from "../bill/graph.ts";
import { Stage } from "../bill/Stage.tsx";
import { loadBundle } from "../lib/data.ts";
import { buildModel } from "../lib/model.ts";
import { billHref, navigate, type Route, type View } from "../lib/router.ts";
import { ClaimProvider } from "../ui/claims.tsx";
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
    <ClaimProvider claims={b.claims}>
      <FocusCtx.Provider value={focus}>
        <Top crumb={b.bill.shortTitle ?? b.bill.display} right={b.bill.law ?? b.bill.display} theme={false} />
        <Verdict m={m} />
        <div className="app">
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
  useEffect(() => {
    document.title = "Not x-rayed yet · antibody";
  }, []);
  let url: string | null = null;
  try {
    url = congressGovUrl(parseBillId(id));
  } catch {}
  return (
    <>
      <Top />
      <main className="home">
        <section className="hero">
          <h1>{id} isn’t x-rayed yet.</h1>
          <p>
            Build it with <code className="mono">bun run antibody xray {id}</code>
            {url && (
              <>
                , or{" "}
                <a href={url} target="_blank" rel="noopener">
                  read it on congress.gov ↗
                </a>
              </>
            )}
            .
          </p>
          <p>
            <a href="/">See every x-rayed bill</a>
          </p>
        </section>
      </main>
    </>
  );
}
