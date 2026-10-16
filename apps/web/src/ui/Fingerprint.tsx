import { useMedia } from "../lib/media.ts";

const MAX_ROWS = 10;

/** One square per section in bill order; very large laws pack several sections per square, loudest mark wins. */
export function fingerprintCells(kinds: string, cols: number) {
  const per = Math.max(1, Math.ceil(kinds.length / (cols * MAX_ROWS)));
  const cells: string[] = [];
  for (let i = 0; i < kinds.length; i += per) {
    const group = kinds.slice(i, i + per);
    cells.push(group.includes("b") ? "b" : group.includes("h") ? "h" : "n");
  }
  return { cells, per };
}

export function Fingerprint({ kinds, label, big = false }: { kinds: string; label: string; big?: boolean }) {
  const phone = useMedia("(max-width: 760px)");
  const [size, pitch, width] = big ? [8, 10, 258] : phone ? [6, 8, 350] : [4, 5, 259];
  const cols = Math.floor((width + pitch - size) / pitch);
  const { cells, per } = fingerprintCells(kinds, cols);
  const rows = Math.max(1, Math.ceil(cells.length / cols));
  const h = rows * pitch - (pitch - size);
  const path = (want: string) =>
    cells
      .map((c, i) =>
        c === want ? `M${(i % cols) * pitch} ${Math.floor(i / cols) * pitch}h${size}v${size}h-${size}z` : "",
      )
      .join("");
  const grey = cells
    .map((c, i) =>
      c === "n" ? `M${(i % cols) * pitch} ${Math.floor(i / cols) * pitch}h${size}v${size}h-${size}z` : "",
    )
    .join("");
  const loud = path("h");
  const flagged = path("b");
  return (
    <svg
      className="fp"
      width={width}
      height={h}
      viewBox={`0 0 ${width} ${h}`}
      role="img"
      aria-label={`${label}: ${kinds.length} sections${per > 1 ? `, one square per ${per}` : ""}`}
    >
      <path d={grey} fill="var(--quiet)" />
      {loud && <path d={loud} fill="var(--iris)" />}
      {flagged && <path d={flagged} fill="var(--flare)" />}
    </svg>
  );
}

export const fingerprintNote = (kinds: string, phone: boolean) => {
  const { per } = fingerprintCells(kinds, phone ? 44 : 52);
  return per > 1 ? `One square is ${per} sections` : null;
};
