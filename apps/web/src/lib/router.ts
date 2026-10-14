import { parseBillId } from "@antibody/core/ids";
import { useSyncExternalStore } from "react";

export const STORY_CHAPTERS = 6;

export type Route =
  | { page: "land" }
  | { page: "xray"; id: string }
  | { page: "story"; id: string; chapter: number | null }
  | { page: "money"; id: string; section: string }
  | { page: "member"; id: string; bioguide: string }
  | { page: "missing" };

export type BillRoute = Exclude<Route, { page: "land" | "missing" }>;

const subscribe = (fn: () => void) => {
  addEventListener("popstate", fn);
  return () => removeEventListener("popstate", fn);
};
const href = () => location.pathname + location.search;

export const landHref = () => "/";
export const libraryHref = () => "/#library";
export const billHref = (id: string) => `/bill/${id}`;
export const storyHref = (id: string, chapter?: number) => `/bill/${id}/story${chapter ? `/${chapter}` : ""}`;
export const sectionHref = (id: string, slug: string) => `/bill/${id}/section/${encodeURIComponent(slug)}`;
export const memberHref = (id: string, bioguide: string) => `/bill/${id}/member/${bioguide}`;

export function routeHref(r: Route): string {
  switch (r.page) {
    case "land":
    case "missing":
      return landHref();
    case "xray":
      return billHref(r.id);
    case "story":
      return storyHref(r.id, r.chapter ?? undefined);
    case "money":
      return sectionHref(r.id, r.section);
    case "member":
      return memberHref(r.id, r.bioguide);
  }
}

/** `/bill/:id?view=money|list&focus=` from the radial map: a focused member or section has its own page now. */
function legacy(id: string, q: URLSearchParams): Route {
  const [kind, key] = q.get("focus")?.split(/:(.*)/s) ?? [];
  if (kind === "member" && key) return { page: "member", id, bioguide: key };
  if (kind === "section" && key) return { page: "money", id, section: key };
  return { page: "xray", id };
}

/** `S.1582`, `s1582` and `119-s-1582` are one bill. */
function canonicalId(id: string): string {
  try {
    return parseBillId(id);
  } catch {
    return id;
  }
}

export function parseRoute(path: string): Route {
  const url = new URL(path, "https://x");
  let seg: string[];
  try {
    seg = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return { page: "missing" };
  }
  if (!seg.length) return { page: "land" };
  const [root, rawId, kind, arg, extra] = seg;
  if (root !== "bill" || !rawId) return { page: "missing" };
  const id = canonicalId(rawId);
  if (!kind) return legacy(id, url.searchParams);
  if (extra) return { page: "missing" };
  if (kind === "story") {
    if (arg === undefined) return { page: "story", id, chapter: null };
    const chapter = /^\d+$/.test(arg) ? Number(arg) : 0;
    return chapter >= 1 && chapter <= STORY_CHAPTERS ? { page: "story", id, chapter } : { page: "missing" };
  }
  if (kind === "section" && arg) return { page: "money", id, section: arg };
  if (kind === "member" && arg) return { page: "member", id, bioguide: arg };
  return { page: "missing" };
}

export const useRoute = (): Route => parseRoute(useSyncExternalStore(subscribe, href, href));

export function navigate(to: string, { replace = false } = {}) {
  if (to === href() && !to.includes("#")) return;
  const go = () => {
    history[replace ? "replaceState" : "pushState"](null, "", to);
    dispatchEvent(new PopStateEvent("popstate"));
  };
  if (!replace && document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches)
    document.startViewTransition(go);
  else go();
  if (replace) return;
  const { hash } = new URL(to, location.origin);
  if (hash) requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView());
  else scrollTo({ top: 0 });
}

/** In-app links: plain anchors that skip the reload, so middle-click and copy-link still work. */
export function onLink(e: React.MouseEvent<HTMLAnchorElement>) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.currentTarget;
  if (a.target || a.origin !== location.origin) return;
  e.preventDefault();
  navigate(a.pathname + a.search + a.hash);
}
