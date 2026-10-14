import { Component, lazy, type ReactNode, Suspense } from "react";
import { useRoute } from "./lib/router.ts";
import { IndexPage } from "./pages/IndexPage.tsx";
import { Top } from "./ui/Top.tsx";

const BillPage = lazy(() => import("./pages/BillPage.tsx"));

export function App() {
  const route = useRoute();
  return (
    <Catch key={route.page === "bill" ? route.id : "index"}>
      <Suspense fallback={route.page === "bill" ? <BillSkeleton /> : <Loading />}>
        {route.page === "bill" ? <BillPage route={route} /> : <IndexPage />}
      </Suspense>
    </Catch>
  );
}

function BillSkeleton() {
  return (
    <>
      <Top />
      <div className="skel" role="status" aria-label="Loading the x-ray">
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
