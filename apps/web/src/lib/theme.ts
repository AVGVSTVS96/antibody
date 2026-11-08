import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const KEY = "antibody-theme";
const media = matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function fromStorage<T>(act: (storage: Storage) => T): T | null {
  try {
    return act(localStorage);
  } catch {
    return null;
  }
}

const notify = () => {
  for (const l of listeners) {
    l();
  }
};

export function initTheme() {
  const q = new URLSearchParams(location.search).get("theme");
  const saved = fromStorage((s) => s.getItem(KEY));

  const t = q === "light" || q === "dark" ? q : saved === "light" || saved === "dark" ? saved : null;

  if (t) {
    document.documentElement.dataset.theme = t;
  }

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

  if ("startViewTransition" in document && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.startViewTransition(apply);
  } else {
    apply();
  }

  fromStorage((s) => {
    s.setItem(KEY, next);
  });
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);

  return () => listeners.delete(fn);
};

export const useTheme = () => useSyncExternalStore(subscribe, currentTheme, currentTheme);
