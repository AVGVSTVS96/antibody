import { useSyncExternalStore } from "react";

export type View = "map" | "money" | "list";
export type Route = { page: "index" } | { page: "bill"; id: string; view: View; focus: string | null };

const subscribe = (fn: () => void) => {
  addEventListener("popstate", fn);
  return () => removeEventListener("popstate", fn);
};
const href = () => location.pathname + location.search;

export function parseRoute(path: string): Route {
  const url = new URL(path, "https://x");
  const bill = url.pathname.match(/^\/bill\/([^/]+)\/?$/);
  if (!bill) return { page: "index" };
  const v = url.searchParams.get("view");
  return {
    page: "bill",
    id: decodeURIComponent(bill[1]!),
    view: v === "money" || v === "list" ? v : "map",
    focus: url.searchParams.get("focus"),
  };
}

export function useRoute(): Route {
  return parseRoute(useSyncExternalStore(subscribe, href, href));
}

export function navigate(to: string, { replace = false } = {}) {
  if (to === href()) return;
  const go = () => {
    history[replace ? "replaceState" : "pushState"](null, "", to);
    dispatchEvent(new PopStateEvent("popstate"));
  };
  if (!replace && document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches)
    document.startViewTransition(go);
  else go();
  if (!replace) scrollTo({ top: 0 });
}

export function billHref(id: string, view: View = "map", focus: string | null = null) {
  const q = new URLSearchParams();
  if (view !== "map") q.set("view", view);
  if (focus) q.set("focus", focus);
  const s = q.toString();
  return `/bill/${id}${s ? `?${s}` : ""}`;
}

/** In-app links: plain anchors that skip the reload, so middle-click and copy-link still work. */
export function onLink(e: React.MouseEvent<HTMLAnchorElement>) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.currentTarget;
  if (a.target || a.origin !== location.origin) return;
  e.preventDefault();
  navigate(a.pathname + a.search);
}
