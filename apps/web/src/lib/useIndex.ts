import type { BundleIndex } from "@antibody/core";
import { useEffect, useState } from "react";
import { loadIndex } from "./data.ts";

/** The library index, null until it has loaded. */
export function useIndex(): BundleIndex | null {
  const [index, setIndex] = useState<BundleIndex | null>(null);
  useEffect(() => {
    let live = true;
    loadIndex()
      .then((i) => live && setIndex(i))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return index;
}
