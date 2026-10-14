import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { navigate, sectionHref } from "../lib/router.ts";
import type { Tape } from "../lib/tape.ts";
import { counts, type Filter, type Sort, select } from "./derive.ts";
import { reading } from "./store.ts";

export const PAGE = 40;
const FLASH_MS = 900;

const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The pinned tape's height, kept in `--tape-h` on the page so sticky panels and scroll stops clear it. */
function useTapeHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".xray");
    const tape = root?.querySelector<HTMLElement>(":scope > .tape");
    if (!root || !tape) return;
    const measure = () => {
      const next = Math.round(tape.getBoundingClientRect().height);
      root.style.setProperty("--tape-h", `${next}px`);
      setH(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(tape);
    return () => ro.disconnect();
  }, []);
  return h;
}

/** Which row sits just under the pinned tape: a one-pixel band, so the browser does the watching. */
function useReading(rowCount: number, tapeH: number) {
  useEffect(() => {
    if (!rowCount) return;
    const vh = innerHeight;
    const top = tapeH + 16;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.row!;
          if (e.isIntersecting) reading.set(id);
          else if (reading.get() === id) reading.set(null);
        }
      },
      { rootMargin: `-${top}px 0px -${Math.max(0, vh - top - 1)}px 0px` },
    );
    for (const el of document.querySelectorAll("[data-row]")) io.observe(el);
    return () => {
      io.disconnect();
      reading.set(null);
    };
  }, [rowCount, tapeH]);
}

export function useReader(tape: Tape, billId: string) {
  const rows = tape.rows;
  const tally = useMemo(() => counts(rows), [rows]);
  const first: Filter = tally.quiet ? "quiet" : "all";
  const [filter, setFilterRaw] = useState<Filter>(first);
  const [sort, setSortRaw] = useState<Sort>("order");
  const list = useMemo(() => select(rows, filter, sort), [rows, filter, sort]);
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(first === "quiet" ? [list[0]!.id] : []));
  const [flash, setFlash] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const cursor = useRef<string | null>(null);
  const tapeH = useTapeHeight();
  useReading(Math.min(shown, list.length), tapeH);

  const setFilter = (f: Filter) => {
    setFilterRaw(f);
    setShown(PAGE);
  };
  const setSort = (s: Sort) => {
    setSortRaw(s);
    setShown(PAGE);
  };
  const more = useCallback(() => setShown((s) => s + PAGE), []);
  const toggle = useCallback(
    (id: string) =>
      setOpen((cur) => {
        const next = new Set(cur);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );

  const go = useCallback(
    (id: string) => {
      const visible = list.some((r) => r.id === id);
      const where = visible ? list : rows;
      if (!visible) {
        setFilterRaw("all");
        setSortRaw("order");
      }
      const at = where.findIndex((r) => r.id === id);
      setShown((s) => Math.max(visible ? s : PAGE, at + 12));
      setOpen(new Set([id]));
      setTarget(id);
      cursor.current = id;
    },
    [list, rows],
  );

  const jump = useRef(go);
  jump.current = go;
  useEffect(() => {
    let done = "";
    const onHash = () => {
      const [, slug] = /^#section-(.+)$/.exec(location.hash) ?? [];
      if (!slug || location.hash === done) return;
      done = location.hash;
      let id = slug;
      try {
        id = decodeURIComponent(slug);
      } catch {}
      const row = rows.find((r) => r.routeId === id);
      if (row) {
        reading.set(row.id);
        jump.current(row.id);
      }
    };
    onHash();
    addEventListener("popstate", onHash);
    return () => removeEventListener("popstate", onHash);
  }, [rows]);

  useEffect(() => {
    if (!target) return;
    const el = document.querySelector(`[data-row="${CSS.escape(target)}"]`);
    el?.scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "start" });
    if (el && !calm()) {
      // Rows the scroll passes over settle at their real heights, so the stop it aimed at has moved: align once more.
      const settle = () => el.scrollIntoView({ block: "start" });
      addEventListener("scrollend", settle, { once: true });
    }
    setFlash(target);
    setTarget(null);
  }, [target]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    const release = () => {
      cursor.current = null;
    };
    const step = (dir: 1 | -1) => {
      const at = list.findIndex((r) => r.id === (cursor.current ?? reading.get()));
      const next = at < 0 ? 0 : Math.min(list.length - 1, Math.max(0, at + dir));
      if (list[next]) go(list[next].id);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || document.getElementById("root")?.inert) return;
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "j" || e.key === "k") step(e.key === "j" ? 1 : -1);
      else if (e.key === "Enter" && document.activeElement === document.body) {
        const row = rows.find((r) => r.id === (cursor.current ?? reading.get()));
        if (row) navigate(sectionHref(billId, row.routeId));
      }
    };
    addEventListener("keydown", onKey);
    addEventListener("wheel", release, { passive: true });
    addEventListener("touchmove", release, { passive: true });
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("wheel", release);
      removeEventListener("touchmove", release);
    };
  }, [list, rows, go, billId]);

  return {
    tally,
    filter,
    setFilter,
    sort,
    setSort,
    list,
    shown,
    more,
    open,
    toggle,
    flash,
    go,
  };
}

export type Reader = ReturnType<typeof useReader>;
