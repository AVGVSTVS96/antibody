import { useCallback, useId, useState } from "react";
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

export function Switch({ view, onChange, empty, equal = false }: Props) {
  const name = useId();
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  const [ready, setReady] = useState(false);

  const box = useCallback(
    (fieldset: HTMLFieldSetElement | null) => {
      if (!fieldset) {
        return;
      }

      const place = () => {
        const label = fieldset.querySelector(`[data-view="${view}"]`);

        if (label instanceof HTMLElement) {
          setPill({ x: label.offsetLeft, w: label.offsetWidth });
        }
      };

      place();
      const ro = new ResizeObserver(place);
      ro.observe(fieldset);

      const raf = requestAnimationFrame(() => {
        setReady(true);
      });

      return () => {
        ro.disconnect();
        cancelAnimationFrame(raf);
      };
    },
    [view],
  );

  return (
    <fieldset ref={box} className={`sc-switch${equal ? " sc-equal" : ""}${ready ? " sc-ready" : ""}`} data-keep>
      <legend className="sc-sr">Map view</legend>
      {pill && (
        <span className="sc-pill" style={{ transform: `translateX(${pill.x}px)`, width: pill.w }} aria-hidden="true" />
      )}
      {VIEWS.map((v) => (
        <label
          key={v.id}
          data-view={v.id}
          data-empty={(empty[v.id] ?? "") === "" ? undefined : ""}
          title={empty[v.id] ?? undefined}
        >
          <input
            type="radio"
            name={name}
            className="sc-sr"
            checked={view === v.id}
            onChange={() => {
              onChange(v.id);
            }}
          />
          <span>{v.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
