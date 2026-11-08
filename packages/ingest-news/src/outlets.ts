import { TABLES } from "@antibody/core";
import type { Row } from "@antibody/core";
import type { z } from "zod";
import list from "../data/outlets.json" with { type: "json" };

export const PARTISAN_GROUPS = ["left", "center-left", "center", "center-right", "right"] as const;

export type Partisan = (typeof PARTISAN_GROUPS)[number];

export type Group = Row<"outlets">["group"];

export function midpoint(qs: Partisan[]): Partisan | null {
  if (!qs.length) {
    return null;
  }

  const idx = qs.map((q) => PARTISAN_GROUPS.indexOf(q));
  const mid = (Math.min(...idx) + Math.max(...idx)) / 2;

  return PARTISAN_GROUPS[mid < 2 ? Math.ceil(mid) : Math.floor(mid)] ?? null;
}

export const SIDE_NAMES = ["left", "center", "right"] as const;

export type Side = (typeof SIDE_NAMES)[number];

export const SIDES = {
  left: ["left", "center-left"],
  center: ["center"],
  right: ["center-right", "right"],
} as const satisfies Record<Side, readonly Group[]>;

export function sideOf(group: Group): Side | null {
  return SIDE_NAMES.find((side) => SIDES[side].some((g) => g === group)) ?? null;
}

const listedOutlet = TABLES.outlets.schema.pick({ domain: true, name: true, group: true, mediacloud_id: true }).strip();

export type Outlet = z.infer<typeof listedOutlet>;

export const OUTLETS: Outlet[] = listedOutlet.array().parse(list.outlets);

export const OUTLET_LIST = { version: list.version, rule: list.rule, sources: list.sources, outlets: OUTLETS };
export const COUNTED = OUTLETS.filter((o) => o.group !== "trade-legal");
export const TRADE_LEGAL = OUTLETS.filter((o) => o.group === "trade-legal");

export function outletRows(): Row<"outlets">[] {
  return OUTLETS.map((o) => ({
    id: o.domain,
    name: o.name,
    domain: o.domain,
    group: o.group,
    list_version: OUTLET_LIST.version,
    mediacloud_id: o.mediacloud_id,
  }));
}

export function outletFor(urlOrDomain: string): Outlet | null {
  const host = (URL.parse(urlOrDomain)?.hostname ?? urlOrDomain).toLowerCase().replace(/^www\./u, "");
  const labels = host.split(".");

  for (let i = 0; i < labels.length - 1; i++) {
    const domain = labels.slice(i).join(".");
    const hit = OUTLETS.find((o) => o.domain === domain);

    if (hit) {
      return hit;
    }
  }

  return null;
}
