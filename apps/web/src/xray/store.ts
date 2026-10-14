import { useSyncExternalStore } from "react";

/** A value many small components read, so one change re-renders only the readers (hover must not re-render the list). */
function value<T>(initial: T) {
  let current = initial;
  const subs = new Set<() => void>();
  const subscribe = (fn: () => void) => {
    subs.add(fn);
    return () => void subs.delete(fn);
  };
  return {
    get: () => current,
    set(next: T) {
      if (next === current) return;
      current = next;
      for (const fn of subs) fn();
    },
    use: () => useSyncExternalStore(subscribe, () => current),
  };
}

/** The section the pointer is on, in the tape, the dots or the list: the others light it. */
export const hover = value<string | null>(null);
/** The section the reader's eye is at in the list. */
export const reading = value<string | null>(null);
/** The section a jump (tape click, dot, hash link, J/K) landed on: it owns the marker until the reader scrolls on their own. */
export const jumped = value<string | null>(null);
