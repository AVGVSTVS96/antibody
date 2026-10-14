import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { loadBundle } from "../lib/data.ts";
import { type BillModel, modelOf } from "../lib/model.ts";

const PHONE = "(max-width: 720px)";

const watchPhone = (fn: () => void) => {
  const q = matchMedia(PHONE);
  q.addEventListener("change", fn);
  return () => q.removeEventListener("change", fn);
};

/** The phone layout (the foundation's 720px breakpoint), so the page renders one version of each block, not two. */
export const usePhone = () =>
  useSyncExternalStore(
    watchPhone,
    () => matchMedia(PHONE).matches,
    () => false,
  );

export interface Featured {
  model: BillModel | null;
  failed: boolean;
}

/** The bill's model once its bundle has loaded, so the page can paint from the index alone and fill in after. */
export function useFeatured(id: string | undefined): Featured {
  const [loaded, setLoaded] = useState<{ id: string; model: BillModel | null } | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    loadBundle(id)
      .then((b) => live && setLoaded({ id, model: b && modelOf(b) }))
      .catch(() => live && setLoaded({ id, model: null }));
    return () => {
      live = false;
    };
  }, [id]);
  return useMemo(() => {
    const here = loaded?.id === id ? loaded : null;
    return { model: here?.model ?? null, failed: !!here && !here.model };
  }, [loaded, id]);
}
