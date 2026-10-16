import type { BundleIndex } from "@antibody/core";
import { parseBillId } from "@antibody/core/ids";
import { Component, lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import { loadIndex } from "./lib/data.ts";
import { useRoute } from "./lib/router.ts";
import { IndexPage } from "./pages/IndexPage.tsx";
import { Footer, Top } from "./ui/Top.tsx";

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
  const name = entry?.shortTitle ?? entry?.title;
  return (
    <>
      <Top crumb={name ?? entry?.display} find />
      <main className="skel" role="status" aria-label="Loading the x-ray">
        <div className="wrap skel-head">
          <span className="skel-k">{entry ? `${entry.display}, ${entry.congress}th Congress` : " "}</span>
          <h1>{name ?? <span className="bone" style={{ width: "min(560px, 80%)", height: 64 }} />}</h1>
          <div className="bone" style={{ width: "min(700px, 100%)", height: 84 }} />
        </div>
      </main>
    </>
  );
}

export function Loading() {
  return <div className="loading" role="status" aria-label="Loading" />;
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
        <main className="wrap hero">
          <div className="hero-copy">
            <h1>Something broke loading this page.</h1>
            <p className="lead">{this.state.error.message}</p>
            <p>
              <a className="link" href="/">
                Back to all bills
              </a>
            </p>
          </div>
        </main>
        <Footer>
          <span>Public, citable data only.</span>
        </Footer>
      </>
    );
  }
}
