import { createContext, useContext } from "react";

/**
 * What the reader is pointing at, shared by the sidebar and the map: hovering a row lights its node,
 * clicking pins it and opens its card on the map.
 */
export interface Focus {
  hover: string | null;
  pinned: string | null;
  setHover: (id: string | null) => void;
  pin: (id: string | null) => void;
}

export const FocusCtx = createContext<Focus>({ hover: null, pinned: null, setHover() {}, pin() {} });
export const useFocus = () => useContext(FocusCtx);

/** Props for a sidebar row that points at a map node. */
export function useRowFocus() {
  const f = useFocus();
  return (id: string) => ({
    onPointerEnter: () => f.setHover(id),
    onPointerLeave: () => f.setHover(null),
    onClick: (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("a,button,summary")) return;
      f.pin(f.pinned === id ? null : id);
    },
    className: `hot${f.pinned === id || f.hover === id ? " on" : ""}`,
  });
}
