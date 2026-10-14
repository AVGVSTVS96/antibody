import { useEffect, useRef, useState } from "react";

/** Eases a number to its new value over `ms`, or jumps when the reader asked for less motion. */
export function useTween(target: number, ms = 200): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  const shown = useRef(target);
  shown.current = value;
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    const start = performance.now();
    from.current = shown.current;
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / ms);
      setValue(from.current + (target - from.current) * (1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return value;
}
