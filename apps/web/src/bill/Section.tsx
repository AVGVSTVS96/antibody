import type { ReactNode } from "react";

export function Section({
  id,
  title,
  children,
  className = "",
}: {
  id?: string;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`wrap bsec ${className}`} id={id} aria-labelledby={id ? `${id}-h` : undefined}>
      <h2 id={id ? `${id}-h` : undefined}>{title}</h2>
      {children}
    </section>
  );
}
