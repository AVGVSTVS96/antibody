import { Component, lazy, type ReactNode, Suspense } from "react";
import { useRoute } from "./lib/router.ts";
import { IndexPage } from "./pages/IndexPage.tsx";
import { Top } from "./ui/Top.tsx";

const BillPage = lazy(() => import("./pages/BillPage.tsx"));

export function App() {
  const route = useRoute();
  return (
    <Catch key={route.page === "bill" ? route.id : "index"}>
      <Suspense fallback={<Loading />}>{route.page === "bill" ? <BillPage route={route} /> : <IndexPage />}</Suspense>
    </Catch>
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
