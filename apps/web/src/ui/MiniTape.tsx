import { useMemo, useRef } from "react";
import { count } from "../lib/format.ts";
import { useWidth } from "./useWidth.ts";
import "./tape.css";

const PITCH = 4;
const MAX_W = 24;
const RANK: Record<string, number> = { n: 0, u: 0, h: 1, b: 2 };

/** One bar per section, or per run of sections when the bill has more than fit; a run shows its most flagged section. */
function bars(fingerprint: string, width: number) {
  const n = fingerprint.length;
  const bins = Math.min(n, Math.max(1, Math.floor(width / PITCH)));
  const bw = width / bins;
  const w = Math.min(MAX_W, Math.max(Math.round(bw - 1), 2));
  const inset = bw - 1 > MAX_W ? (bw - MAX_W) / 2 : 0;
  const out: { x: number; kind: string }[] = [];
  for (let i = 0; i < bins; i++) {
    let kind = "n";
    for (let k = Math.floor((i * n) / bins); k < Math.floor(((i + 1) * n) / bins); k++)
      if (RANK[fingerprint[k]!]! > RANK[kind]!) kind = fingerprint[k]!;
    out.push({ x: Math.round(i * bw + inset), kind });
  }
  return { w, out };
}

/**
 * A bill's sections in text order, small: gray is the rest, black a headline section, yellow quiet and costly. From
 * the index's `stats.fingerprint` alone (one letter per final section: h, b, n, u), so it carries no dollars or late flags.
 */
export function MiniTape({
  fingerprint,
  height = 36,
  label,
}: {
  fingerprint: string;
  height?: number;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const { w, out } = useMemo(() => bars(fingerprint, width), [fingerprint, width]);
  const rest = Math.round(height / 3);
  const flagged = (k: string) => out.filter((b) => b.kind === k);
  const path = (kind: string, h: number) =>
    flagged(kind)
      .map((b) => `M${b.x} ${height - h}h${w}v${h}h-${w}z`)
      .join("");
  const headline = [...fingerprint].filter((c) => c === "h").length;
  const quiet = [...fingerprint].filter((c) => c === "b").length;
  return (
    <div
      ref={ref}
      className="mini"
      style={{ height }}
      role="img"
      aria-label={`${label ? `${label}: ` : ""}${count(fingerprint.length, "section")} in order, ${headline} headline, ${quiet} quiet and costly`}
    >
      {width > 0 && (
        <svg width={width} height={height} aria-hidden="true">
          <path d={path("n", rest)} className="mini-other" />
          <path d={path("h", height)} className="mini-loud" />
          <path d={path("b", height)} className="mini-quiet" />
        </svg>
      )}
    </div>
  );
}
