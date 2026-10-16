import { useLayoutEffect, useRef, useState } from "react";
import type { MapView } from "./layout.ts";

export const VIEWS: { id: MapView; label: string }[] = [
  { id: "trades", label: "Stock trades" },
  { id: "pac", label: "PAC money" },
  { id: "sections", label: "Every section" },
];

interface Props {
  view: MapView;
  onChange: (v: MapView) => void;
  empty: Record<MapView, string | null>;
  equal?: boolean;
}

/** Three labels and a pill that slides under the chosen one; views with nothing in them stay pickable and explain themselves. */
export function ViewSwitch({ view, onChange, empty, equal = false }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const place = () => {
      const el = box.current?.querySelector<HTMLElement>('[aria-checked="true"]');
      if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth });
    };
    place();
    const ro = new ResizeObserver(place);
    if (box.current) ro.observe(box.current);
    const raf = requestAnimationFrame(() => setReady(true));
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [view]);

  const onKey = (e: React.KeyboardEvent) => {
    const dir =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const i = VIEWS.findIndex((v) => v.id === view);
    const next = VIEWS[(i + dir + VIEWS.length) % VIEWS.length]!;
    onChange(next.id);
    requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(`[data-view="${next.id}"]`)?.focus());
  };

  return (
    <div
      ref={box}
      className={`sc-switch${equal ? " sc-equal" : ""}${ready ? " sc-ready" : ""}`}
      role="radiogroup"
      aria-label="Map view"
      data-keep
      onKeyDown={onKey}
    >
      {pill && (
        <span className="sc-pill" style={{ transform: `translateX(${pill.x}px)`, width: pill.w }} aria-hidden="true" />
      )}
      {VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          role="radio"
          aria-checked={view === v.id}
          data-view={v.id}
          data-empty={empty[v.id] ? "" : undefined}
          tabIndex={view === v.id ? 0 : -1}
          title={empty[v.id] ?? undefined}
          onClick={() => onChange(v.id)}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
