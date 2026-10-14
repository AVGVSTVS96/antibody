import type { ElementType, ReactNode } from "react";

/** The page's content column: 1440 wide at most, with the gutter the boards use. */
export function Wrap({
  as: T = "div",
  className,
  children,
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  return <T className={`wrap${className ? ` ${className}` : ""}`}>{children}</T>;
}

/** The mono step label above a heading: `STEP 2 · X-RAY · 119TH CONGRESS`. */
export function Kicker({
  as: T = "p",
  className,
  children,
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  return <T className={`kicker${className ? ` ${className}` : ""}`}>{children}</T>;
}

/** A row of big numbers between two heavy rules. Phones wrap it two to a row. */
export function StatRow({ size = "lg", children }: { size?: "lg" | "md"; children: ReactNode }) {
  return (
    <div className="stats" data-size={size}>
      {children}
    </div>
  );
}

/** One big number and what it counts. `tone="quiet"` is the yellow cell: only for the quiet-and-costly count. */
export function Stat({ value, label, tone }: { value: ReactNode; label: ReactNode; tone?: "quiet" }) {
  return (
    <div className="stat" data-tone={tone}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

/**
 * A boxed note. `box` is the white card with the offset shadow ("read this first", "what this page does not say");
 * `dashed` is the dashed frame for what we do not have or only infer.
 */
export function Note({
  title,
  tone = "box",
  children,
}: {
  title: ReactNode;
  tone?: "box" | "dashed";
  children: ReactNode;
}) {
  return (
    <aside className="note" data-tone={tone}>
      <b>{title}</b>
      <div>{children}</div>
    </aside>
  );
}

/** A small mono badge: `ink` (FACT, ADDED LATE), `quiet` (QUIET AND COSTLY), `plain` (outlined). */
export function Tag({
  tone = "plain",
  small,
  children,
}: {
  tone?: "ink" | "quiet" | "plain";
  small?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="tag" data-tone={tone} data-small={small || undefined}>
      {children}
    </span>
  );
}

/** Dashed badge: whatever it sits next to is an inference, not a record. */
export function InferenceTag({ small }: { small?: boolean }) {
  return (
    <span className="tag" data-tone="inference" data-small={small || undefined}>
      {small ? "INFER" : "INFERENCE"}
    </span>
  );
}

export type LegendMark = "loud" | "quiet" | "other" | "split" | "nofigure";

const LEGEND: Record<LegendMark, string> = {
  loud: "HEADLINE",
  quiet: "QUIET AND COSTLY",
  other: "OTHER",
  split: "DASHED = EVEN SPLIT (INFERENCE)",
  nofigure: "NO CBO FIGURE",
};

/** The key for the tape and every chart that uses its colors. Pass `labels` to add a count: `{ nofigure: "NO CBO FIGURE (22)" }`. */
export function Legend({
  marks = ["loud", "quiet", "other"],
  labels,
}: {
  marks?: readonly LegendMark[];
  labels?: Partial<Record<LegendMark, string>>;
}) {
  return (
    <ul className="legend">
      {marks.map((m) => (
        <li key={m}>
          <i data-mark={m} aria-hidden="true" />
          {labels?.[m] ?? LEGEND[m]}
        </li>
      ))}
    </ul>
  );
}

/** A page band: a heavy rule, the kicker and heading on the left, `aside` (a legend, a count) on the right. */
export function Section({
  kicker,
  title,
  aside,
  id,
  className,
  children,
}: {
  kicker?: ReactNode;
  title?: ReactNode;
  aside?: ReactNode;
  id?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section className={`band${className ? ` ${className}` : ""}`} id={id}>
      <Wrap>
        {(kicker || title || aside) && (
          <div className="band-head">
            <div>
              {kicker && <Kicker>{kicker}</Kicker>}
              {title && <h2>{title}</h2>}
            </div>
            {aside && <div className="band-aside">{aside}</div>}
          </div>
        )}
        {children}
      </Wrap>
    </section>
  );
}
