import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
const KEY = "antibody-theme";
const media = matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of listeners) l();
};

export function initTheme() {
  const q = new URLSearchParams(location.search).get("theme");
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {}
  const t = q === "light" || q === "dark" ? q : saved === "light" || saved === "dark" ? saved : null;
  if (t) document.documentElement.dataset.theme = t;
  media.addEventListener("change", notify);
}

export function currentTheme(): Theme {
  const set = document.documentElement.dataset.theme;
  return set === "light" || set === "dark" ? set : media.matches ? "dark" : "light";
}

export function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  const apply = () => {
    document.documentElement.dataset.theme = next;
    notify();
  };
  if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches)
    document.startViewTransition(apply);
  else apply();
  try {
    localStorage.setItem(KEY, next);
  } catch {}
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const useTheme = () => useSyncExternalStore(subscribe, currentTheme, currentTheme);

/** The CSS color tokens as values, for the WebGL map, which can't read CSS variables. */
export function palette() {
  const s = getComputedStyle(document.documentElement);
  const v = (k: string) => s.getPropertyValue(`--${k}`).trim();
  return {
    bg: v("bg"),
    panel: v("panel"),
    card: v("card"),
    card2: v("card-2"),
    line: v("line"),
    line2: v("line-2"),
    text: v("text"),
    muted: v("muted"),
    dim: v("dim"),
    violet: v("violet"),
    red: v("red"),
    gold: v("gold"),
    teal: v("teal"),
    steel: v("steel"),
    grey: v("grey"),
    seal: v("seal"),
  };
}
export type Palette = ReturnType<typeof palette>;
