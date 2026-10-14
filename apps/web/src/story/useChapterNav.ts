import { type RefObject, useEffect } from "react";
import { navigate, STORY_CHAPTERS, storyHref } from "../lib/router.ts";

const SWIPE = { distance: 56, slant: 1.6 };

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/**
 * Moves between chapters by arrow key and by horizontal swipe on `stage`. A drag that starts on a chart marked
 * `data-noswipe` belongs to the chart, and nothing moves while the receipt is open.
 */
export function useChapterNav(stage: RefObject<HTMLElement | null>, id: string, n: number) {
  useEffect(() => {
    const go = (to: number) => {
      if (to >= 1 && to <= STORY_CHAPTERS) navigate(storyHref(id, to));
    };
    const blocked = () => !!document.getElementById("root")?.hasAttribute("inert");

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || typing(e.target) || blocked())
        return;
      if (e.key === "ArrowRight") go(n + 1);
      else if (e.key === "ArrowLeft") go(n - 1);
    };

    let from: { x: number; y: number } | null = null;
    const el = stage.current;
    const down = (e: PointerEvent) => {
      from =
        e.pointerType === "touch" && e.isPrimary && !(e.target as Element).closest("[data-noswipe]")
          ? { x: e.clientX, y: e.clientY }
          : null;
    };
    const up = (e: PointerEvent) => {
      if (!from || blocked()) return;
      const dx = e.clientX - from.x;
      const dy = e.clientY - from.y;
      from = null;
      if (Math.abs(dx) >= SWIPE.distance && Math.abs(dx) > SWIPE.slant * Math.abs(dy)) go(dx < 0 ? n + 1 : n - 1);
    };
    const cancel = () => {
      from = null;
    };

    addEventListener("keydown", onKey);
    el?.addEventListener("pointerdown", down);
    el?.addEventListener("pointerup", up);
    el?.addEventListener("pointercancel", cancel);
    return () => {
      removeEventListener("keydown", onKey);
      el?.removeEventListener("pointerdown", down);
      el?.removeEventListener("pointerup", up);
      el?.removeEventListener("pointercancel", cancel);
    };
  }, [stage, id, n]);
}
