import type { BundleIndex } from "@antibody/core";
import { parseBillId } from "@antibody/core/ids";
import { Component, lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import { loadIndex } from "./lib/data.ts";
import { useRoute } from "./lib/router.ts";
import { IndexPage } from "./pages/IndexPage.tsx";
import { Top } from "./ui/Top.tsx";

const BillPage = lazy(() => import("./pages/BillPage.tsx"));

export function App() {
  const route = useRoute();
  return (
    <Catch key={route.page === "bill" ? route.id : "index"}>
      <Suspense fallback={route.page === "bill" ? <BillSkeleton id={route.id} /> : <Loading />}>
        {route.page === "bill" ? <BillPage route={route} /> : <IndexPage />}
      </Suspense>
    </Catch>
  );
}

function BillSkeleton({ id }: { id: string }) {
  const [entry, setEntry] = useState<BundleIndex["bills"][number] | null>(null);
  useEffect(() => {
    let live = true;
    let want = id;
    try {
      want = parseBillId(id);
    } catch {}
    loadIndex()
      .then((i) => live && setEntry(i.bills.find((b) => b.id === want) ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id]);
  return (
    <>
      <Top crumb={entry?.shortTitle ?? entry?.display} />
      <div className="skel" role="status" aria-label="Loading the x-ray">
        <div className="skelhead">
          <h1>
            {entry ? (entry.shortTitle ?? entry.title) : <span className="bone line" />}{" "}
            {entry && <span className="mono">{entry.display}</span>}
          </h1>
        </div>
        <div className="story">
          {[0, 1, 2].map((i) => (
            <div key={i} className="beat bone" />
          ))}
        </div>
        <div className="app">
          <aside className="side">
            <div className="card bone tall" />
          </aside>
          <section className="stage">
            <svg viewBox="-512 -512 1024 1024" className="ringskel" aria-hidden="true">
              <circle r="440" />
              <circle r="320" />
              <circle r="180" />
            </svg>
          </section>
        </div>
      </div>
    </>
  );
}

export function Loading({ what = "Loading" }: { what?: string }) {
  return (
    <div className="loading">
      <span className="cap">{what}</span>
    </div>
  );
}

class Catch extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <>
        <Top />
        <div className="home">
          <div className="hero">
            <h1>Something broke loading this page.</h1>
            <p className="mono">{this.state.error.message}</p>
            <p>
              <a href="/">Back to all bills</a>
            </p>
          </div>
        </div>
      </>
    );
  }
}
