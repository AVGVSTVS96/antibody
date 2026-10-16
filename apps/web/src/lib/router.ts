import { useSyncExternalStore } from "react";

export type MapView = "trades" | "pac" | "sections";
export type Route = { page: "index" } | { page: "bill"; id: string; list: boolean; map: MapView; focus: string | null };

const subscribe = (fn: () => void) => {
  addEventListener("popstate", fn);
  return () => removeEventListener("popstate", fn);
};
const href = () => location.pathname + location.search;

const MAPS: MapView[] = ["trades", "pac", "sections"];

export function parseRoute(path: string): Route {
  const url = new URL(path, "https://x");
  const bill = url.pathname.match(/^\/bill\/([^/]+)\/?$/);
  if (!bill) return { page: "index" };
  const map = url.searchParams.get("map");
  return {
    page: "bill",
    id: decodeURIComponent(bill[1]!),
    list: url.searchParams.get("view") === "list",
    map: MAPS.find((m) => m === map) ?? "trades",
    focus: url.searchParams.get("focus"),
  };
}

export function useRoute(): Route {
  return parseRoute(useSyncExternalStore(subscribe, href, href));
}

export function navigate(to: string, { replace = false } = {}) {
  const [path, hash] = to.split("#");
  if (!hash && path === href()) return;
  const go = () => {
    history[replace ? "replaceState" : "pushState"](null, "", to);
    dispatchEvent(new PopStateEvent("popstate"));
  };
  if (!replace && document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches)
    document.startViewTransition(go);
  else go();
  if (replace) return;
  if (hash) requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView());
  else scrollTo({ top: 0 });
}

interface BillLink {
  list?: boolean;
  map?: MapView;
  focus?: string | null;
}

export function billHref(id: string, { list = false, map = "trades", focus = null }: BillLink = {}) {
  const q = new URLSearchParams();
  if (list) q.set("view", "list");
  if (map !== "trades") q.set("map", map);
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
  navigate(a.pathname + a.search + a.hash);
}
