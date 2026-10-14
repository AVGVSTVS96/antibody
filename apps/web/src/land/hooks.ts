import { useSyncExternalStore } from "react";

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
