import type { CSSProperties, ReactNode } from "react";
import type { BillModel, SectionView } from "../lib/model.ts";
import { sectionHref } from "../lib/router.ts";
import { Tag } from "../ui/primitives.tsx";
import { Src } from "../ui/receipt.tsx";
import { figure } from "./data.ts";
import { Num } from "./parts.tsx";

const BAR_MAX = 0.62;

/** One section on a zero line: cuts hang left, adds grow right, the CBO figure at the tip opens its receipt. */
export function DollarRow({
  m,
  v,
  dollars,
  evenSplit,
  scale,
  i,
  tag,
  children,
}: {
  m: BillModel;
  v: SectionView;
  dollars: number | null;
  evenSplit?: boolean;
  scale: number;
  i: number;
  tag?: "loud" | "quiet";
  children?: ReactNode;
}) {
  const side = dollars == null ? "none" : dollars < 0 ? "cut" : "add";
  const bar = dollars != null && (
    <i
      className="q-bar"
      data-split={evenSplit || undefined}
      style={{ width: `${(Math.abs(dollars) / scale) * BAR_MAX * 100}%` }}
    />
  );
  const fig = dollars != null && v.figure && (
    <span className="fig">
      {evenSplit && "~"}
      <Src ids={v.figure.claims} label={figure(dollars)} />
    </span>
  );
  return (
    <li className="q-row" style={{ "--i": i } as CSSProperties}>
      <Num m={m} v={v} />
      <span className="title">
        <a className="plain" href={sectionHref(m.b.bill.id, m.sectionSlug(v))}>
          {v.s.heading}
        </a>
        {tag === "loud" && (
          <Tag tone="ink" small>
            LOUD
          </Tag>
        )}
        {tag === "quiet" && (
          <Tag tone="quiet" small>
            QUIET
          </Tag>
        )}
      </span>
      <div className="q-track" data-side={side}>
        <div className="q-half cut">
          {side === "cut" && (
            <>
              {fig}
              {bar}
            </>
          )}
        </div>
        <div className="q-half add">
          {side === "add" && (
            <>
              {bar}
              {fig}
            </>
          )}
          {side === "none" && <span className="fig none">no CBO figure</span>}
        </div>
      </div>
      {children}
    </li>
  );
}
