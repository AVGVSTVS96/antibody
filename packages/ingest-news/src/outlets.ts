import type { Row } from "@antibody/core";
import list from "../data/outlets.json" with { type: "json" };

export const PARTISAN_GROUPS = ["left", "center-left", "center", "center-right", "right"] as const;
export type Partisan = (typeof PARTISAN_GROUPS)[number];
export type Group = Row<"outlets">["group"];

/** Midpoint of the quintiles an outlet appears in, rounded toward center. */
export function midpoint(qs: Partisan[]): Partisan | null {
  if (!qs.length) return null;
  const idx = qs.map((q) => PARTISAN_GROUPS.indexOf(q));
  const mid = (Math.min(...idx) + Math.max(...idx)) / 2;
  return PARTISAN_GROUPS[mid < 2 ? Math.ceil(mid) : Math.floor(mid)]!;
}

/** Attention weighs these three sides equally. */
export const SIDES = {
  left: ["left", "center-left"],
  center: ["center"],
  right: ["center-right", "right"],
} as const satisfies Record<string, readonly Group[]>;
export type Side = keyof typeof SIDES;

export function sideOf(group: Group): Side | null {
  for (const [side, groups] of Object.entries(SIDES) as [Side, readonly Group[]][])
    if (groups.includes(group)) return side;
  return null;
}

export interface Outlet {
  domain: string;
  name: string;
  group: Group;
  mediacloud_id: number | null;
}

export const OUTLET_LIST = list as unknown as {
  version: string;
  rule: string[];
  sources: Record<string, string>;
  outlets: Outlet[];
};

export const OUTLETS: Outlet[] = OUTLET_LIST.outlets;
export const COUNTED = OUTLETS.filter((o) => o.group !== "trade-legal");
export const TRADE_LEGAL = OUTLETS.filter((o) => o.group === "trade-legal");

/** Outlet row id is its domain. */
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

/** Matches a URL or Media Cloud media_url to a listed outlet (www. and subdomains fold onto the domain). */
export function outletFor(urlOrDomain: string): Outlet | null {
  let host = urlOrDomain.toLowerCase();
  try {
    host = new URL(urlOrDomain).hostname.toLowerCase();
  } catch {}
  host = host.replace(/^www\./, "");
  for (;;) {
    const hit = OUTLETS.find((o) => o.domain === host);
    if (hit) return hit;
    const dot = host.indexOf(".");
    if (dot < 0 || host.indexOf(".", dot + 1) < 0) return null;
    host = host.slice(dot + 1);
  }
}
