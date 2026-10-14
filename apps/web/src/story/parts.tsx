import type { Bundle } from "@antibody/core";
import type { ReactNode } from "react";
import type { BillModel, SectionView } from "../lib/model.ts";
import { onLink } from "../lib/router.ts";
import { InferenceTag } from "../ui/primitives.tsx";
import { ruleOf } from "./data.ts";

/** A published rule the chapter's labels rest on, with the INFERENCE tag, linking to its text. */
export function RuleChip({ bundle, id }: { bundle: Bundle; id: string }) {
  const rule = ruleOf(bundle, id);
  if (!rule?.url) return null;
  return (
    <a className="rule-chip" href={rule.url} target="_blank" rel="noopener noreferrer">
      <InferenceTag />
      <span>RULE {id.toUpperCase()} ↗</span>
    </a>
  );
}

/** A mono caption over a chart: what one mark is. */
export function Cap({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="cap">
      <span>{children}</span>
      {aside}
    </div>
  );
}

export function LedgerLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} onClick={onLink}>
      {children}
    </a>
  );
}

/** `§70201`, with the version under it when another section of the bill has the same number. */
export function Num({ m, v }: { m: BillModel; v: SectionView }) {
  const [num, version] = m.secLabel(v).split(/ (?=\()/);
  return (
    <span className="num">
      {num}
      {version && <small>{version}</small>}
    </span>
  );
}
