import { Component, lazy, type ReactNode, Suspense, useEffect } from "react";
import { receiptInUrl, withReceipt } from "./lib/receipt-url.ts";
import { type BillRoute, navigate, type Route, routeHref, useRoute } from "./lib/router.ts";
import { BillGate } from "./ui/BillGate.tsx";
import { NotFound } from "./ui/NotFound.tsx";
import { PageSkeleton } from "./ui/Skeleton.tsx";
import { Top } from "./ui/Top.tsx";

const LandPage = lazy(() => import("./pages/LandPage.tsx"));
const XrayPage = lazy(() => import("./pages/XrayPage.tsx"));
const StoryPage = lazy(() => import("./pages/StoryPage.tsx"));
const MoneyPage = lazy(() => import("./pages/MoneyPage.tsx"));
const MemberPage = lazy(() => import("./pages/MemberPage.tsx"));

const LANDING_TITLE = "antibody · X-ray any bill in Congress";

function Page({ route }: { route: BillRoute }) {
  switch (route.page) {
    case "xray":
      return <XrayPage />;
    case "story":
      return <StoryPage route={route} />;
    case "money":
      return <MoneyPage route={route} />;
    case "member":
      return <MemberPage route={route} />;
  }
}

function Screen({ route }: { route: Route }) {
  if (route.page === "missing") return <NotFound />;
  if (route.page === "land") return <LandPage />;
  return (
    <BillGate id={route.id}>
      <Page route={route} />
    </BillGate>
  );
}

export function App() {
  const route = useRoute();
  const canonical = routeHref(route);
  const billId = route.page === "land" || route.page === "missing" ? undefined : route.id;

  useEffect(() => {
    if (route.page === "land" || route.page === "missing") document.title = LANDING_TITLE;
  }, [route.page]);

  useEffect(() => {
    const here = withReceipt(location.pathname + location.search, null);
    if (route.page !== "missing" && here.split("#")[0] !== canonical)
      navigate(withReceipt(canonical, receiptInUrl()), { replace: true });
  }, [route.page, canonical]);

  return (
    <>
      <a className="skip" href="#main">
        Skip to the page
      </a>
      {route.page !== "story" && <Top />}
      <main id="main">
        <Catch key={billId ?? route.page}>
          <Suspense fallback={<PageSkeleton id={billId} />}>
            <Screen route={route} />
          </Suspense>
        </Catch>
      </main>
    </>
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
      <div className="wrap page">
        <p className="kicker">SOMETHING BROKE</p>
        <h1>This page did not load.</h1>
        <p className="lead">
          <code>{this.state.error.message}</code>
        </p>
        <p>
          <a href="/">Back to all bills</a>
        </p>
      </div>
    );
  }
}
