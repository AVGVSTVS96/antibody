import { useCallback, useState, useSyncExternalStore } from "react";

export function useWidth(fallback = 760) {
  const [w, setW] = useState(fallback);

  const ref = useCallback(
    (el: Element | null) => {
      if (!el) {
        return;
      }

      setW(Math.round(el.getBoundingClientRect().width) || fallback);

      const ro = new ResizeObserver(([e]) => {
        if (e) {
          setW(Math.round(e.contentRect.width) || fallback);
        }
      });

      ro.observe(el);

      return () => {
        ro.disconnect();
      };
    },
    [fallback],
  );

  return [ref, w] as const;
}

export function useSeenOnce(threshold: number) {
  const [seen, setSeen] = useState(false);

  const ref = useCallback(
    (el: Element | null) => {
      if (!el) {
        return;
      }

      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setSeen(true);
            io.disconnect();
          }
        },
        { threshold },
      );

      io.observe(el);

      return () => {
        io.disconnect();
      };
    },
    [threshold],
  );

  return [ref, seen] as const;
}

export function useWindowEvent<K extends keyof WindowEventMap>(type: K, listener: (e: WindowEventMap[K]) => void) {
  const subscribe = useCallback(() => {
    addEventListener(type, listener);

    return () => {
      removeEventListener(type, listener);
    };
  }, [type, listener]);

  useSyncExternalStore(subscribe, listening);
}

const listening = () => true;
