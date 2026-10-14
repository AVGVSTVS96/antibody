import { useIndex } from "../lib/useIndex.ts";
import { Kicker, Wrap } from "./primitives.tsx";

/** The shape of a bill page while its bundle loads, with the real title as soon as the index knows the bill. */
export function PageSkeleton({ id }: { id?: string }) {
  const entry = useIndex()?.bills.find((b) => b.id === id);
  return (
    <Wrap className="page skeleton">
      <div role="status" aria-label="Loading">
        <Kicker>{entry ? `${entry.display} · LOADING` : "LOADING"}</Kicker>
        <h1>{entry ? (entry.shortTitle ?? entry.title) : <span className="bone line" />}</h1>
        <div className="bone tape" />
        <div className="skeleton-stats">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bone" />
          ))}
        </div>
      </div>
    </Wrap>
  );
}
