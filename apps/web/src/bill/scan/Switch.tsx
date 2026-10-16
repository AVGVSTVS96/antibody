import { useId, useLayoutEffect, useRef, useState } from "react";
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
export function Switch({ view, onChange, empty, equal = false }: Props) {
  const box = useRef<HTMLFieldSetElement>(null);
  const name = useId();
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const place = () => {
      const el = box.current?.querySelector<HTMLElement>(`[data-view="${view}"]`);
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

  return (
    <fieldset ref={box} className={`sc-switch${equal ? " sc-equal" : ""}${ready ? " sc-ready" : ""}`} data-keep>
      <legend className="sc-sr">Map view</legend>
      {pill && (
        <span className="sc-pill" style={{ transform: `translateX(${pill.x}px)`, width: pill.w }} aria-hidden="true" />
      )}
      {VIEWS.map((v) => (
        <label key={v.id} data-view={v.id} data-empty={empty[v.id] ? "" : undefined} title={empty[v.id] ?? undefined}>
          <input type="radio" name={name} className="sc-sr" checked={view === v.id} onChange={() => onChange(v.id)} />
          <span>{v.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
