import type { Bundle, BundleIndex, Claim } from "@antibody/core";
import { congressGovUrl, parseBillId } from "@antibody/core/ids";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { Built } from "../bill/Built.tsx";
import { Cost } from "../bill/Cost.tsx";
import { Answers, Hero } from "../bill/Hero.tsx";
import { Money } from "../bill/Money.tsx";
import { Records, Rules } from "../bill/Rest.tsx";
import { Trades } from "../bill/Trades.tsx";
import { XrayList } from "../bill/XrayList.tsx";
import { loadBundle, loadClaims, loadIndex } from "../lib/data.ts";
import { day } from "../lib/format.ts";
import { buildModel } from "../lib/model.ts";
import { billHref, type MapView, navigate, onLink, type Route } from "../lib/router.ts";
import { ClaimProvider } from "../ui/claims.tsx";
import { Footer, Top } from "../ui/Top.tsx";

type BillRoute = Extract<Route, { page: "bill" }>;

export default function BillPage({ route }: { route: BillRoute }) {
  let id = route.id;
  try {
    id = parseBillId(route.id);
  } catch {}
  const bundle = use(loadBundle(id));
  const index = use(loadIndex());
  if (!bundle) return <NotFound id={id} index={index} />;
  return <BillView b={bundle} route={route} entry={index.bills.find((x) => x.id === bundle.bill.id)} />;
}

function BillView({ b, route, entry }: { b: Bundle; route: BillRoute; entry?: BundleIndex["bills"][number] }) {
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

  useEffect(() => {
    document.title = `${b.bill.shortTitle ?? b.bill.title} (${b.bill.display}) · antibody`;
  }, [b]);

  const setFocus = useCallback(
    (focus: string | null) => navigate(billHref(b.bill.id, { map: route.map, focus }), { replace: true }),
    [b.bill.id, route.map],
  );
  const setMap = useCallback((map: MapView) => navigate(billHref(b.bill.id, { map }), { replace: true }), [b.bill.id]);
  const name = b.bill.shortTitle ?? b.bill.title;

  return (
    <ClaimProvider claims={claims}>
      <Top crumb={name} find />
      <main>
        {route.list ? (
          <section className="wrap listview">
            <p className="back">
              <a className="link" href={billHref(b.bill.id)} onClick={onLink}>
                Back to {name}
              </a>
            </p>
            <XrayList m={m} />
          </section>
        ) : (
          <>
            <Hero m={m} entry={entry} />
            <Answers m={m} />
            <Cost m={m} />
            <Built m={m} />
            <div id="map" style={{ height: 300 }} data-todo={`${route.focus}${setFocus.length}${setMap.length}`} />
            <Money m={m} />
            <Trades m={m} />
            <Records m={m} />
            <Rules m={m} />
          </>
        )}
      </main>
      <Footer>
        <span>Public, citable data only. Every number links to its record.</span>
        <span>
          Source code and method on{" "}
          <a href="https://github.com/AVGVSTVS96/antibody" target="_blank" rel="noopener">
            GitHub
          </a>
          . Built {day(b.generatedAt.slice(0, 10))}.
        </span>
      </Footer>
    </ClaimProvider>
  );
}

function NotFound({ id, index }: { id: string; index: BundleIndex }) {
  useEffect(() => {
    document.title = "Not x-rayed yet · antibody";
  }, []);
  let url: string | null = null;
  try {
    url = congressGovUrl(parseBillId(id));
  } catch {}
  const start = index.bills.filter((b) => ["119-s-1582", "117-hr-5376", "119-hr-1"].includes(b.id));
  return (
    <>
      <Top find />
      <main className="wrap hero nf">
        <div className="hero-copy">
          <h1>We haven’t x‑rayed this bill yet.</h1>
          <p className="lead">
            <code>{id}</code> isn’t one of the {index.bills.length} bills here so far. The daily watch x-rays the bills
            that move.
            {url && (
              <>
                {" "}
                You can{" "}
                <a className="link" href={url} target="_blank" rel="noopener">
                  read it on congress.gov
                </a>
                , or start with one of these.
              </>
            )}
          </p>
          <ul className="nf-l">
            {start.map((b) => (
              <li key={b.id}>
                <a className="link" href={billHref(b.id)} onClick={onLink}>
                  {b.shortTitle ?? b.title}
                </a>{" "}
                <span>{b.display}</span>
              </li>
            ))}
          </ul>
        </div>
      </main>
      <Footer>
        <span>Public, citable data only.</span>
      </Footer>
    </>
  );
}
