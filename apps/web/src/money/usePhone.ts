import { useSyncExternalStore } from "react";

const query = "(max-width: 720px)";
const subscribe = (fn: () => void) => {
  const mq = matchMedia(query);
  mq.addEventListener("change", fn);
  return () => mq.removeEventListener("change", fn);
};

/** Whether the screen is phone-sized (the shell's 720px break). */
export const usePhone = () => useSyncExternalStore(subscribe, () => matchMedia(query).matches);
