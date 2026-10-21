import type { BillStatus } from "./billstatus.ts";

export interface VersionRef {
  /** GovInfo version code: ih, rh, eh, pcs, eas, enr … and `plaw` for the public law. */
  code: string;
  name: string;
  date: string | null;
  url: string;
  file: string;
}

/** Order of stages when two versions carry the same date. */
const STAGE = [
  ["ih", "is", "iph", "ips"],
  ["rih", "ris", "rh", "rs", "rch", "rcs", "rdh", "rds", "rfh", "rfs", "rah", "ras", "rth", "rts", "cph", "cps"],
  ["pch", "pcs", "pp", "pap", "pwh", "fph", "fps"],
  ["eh", "es", "ath", "ats", "eph", "lth", "lts"],
  ["eah", "eas", "ash", "as", "hdh", "hds", "sc", "renr"],
  ["enr"],
];
const rank = (code: string) => {
  const i = STAGE.findIndex((s) => s.includes(code));
  return i < 0 ? 4 : i;
};

function pick(urls: string[]): { url: string; file: string; code: string } | null {
  const plaw = urls.find((u) => /\/uslm\/PLAW-/.test(u));
  if (plaw) return { url: plaw, file: versionFile(plaw), code: "plaw" };
  const url = urls.find((u) => /\/xml\/BILLS-/.test(u)) ?? urls.find((u) => /\/uslm\/BILLS-/.test(u));
  const m = url?.match(/BILLS-\d+[a-z]+?\d+([a-z]+)\.xml$/);
  if (!url || !m) return null;
  return { url, file: versionFile(url), code: m[1]! };
}

/** The file a version's XML is cached as in data/bills/raw (bill XML and USLM XML share a name, so USLM is prefixed). */
export function versionFile(url: string): string {
  const name = url.slice(url.lastIndexOf("/") + 1);
  return url.includes("/uslm/BILLS-") ? `USLM-${name}` : name;
}

/** Every text version BILLSTATUS lists with an XML file, oldest first; the enrolled bill and then the law go last. */
export function textVersions(status: BillStatus): VersionRef[] {
  const presented = status.actions.find((a) => a.text.startsWith("Presented to President"))?.date ?? null;
  const out: VersionRef[] = [];
  for (const v of status.textVersions) {
    const hit = pick(v.urls);
    if (!hit || out.some((o) => o.code === hit.code)) continue;
    const date = hit.code === "plaw" ? (status.lawOn ?? v.date) : hit.code === "enr" ? (v.date ?? presented) : v.date;
    const name = hit.code === "plaw" && status.law ? `Public Law ${status.law.replace(/^\S+ /, "")}` : v.name;
    out.push({ ...hit, name, date });
  }
  const tier = (v: VersionRef) => (v.code === "plaw" ? 2 : v.code === "enr" ? 1 : 0);
  return out.sort(
    (a, b) => tier(a) - tier(b) || (a.date ?? "").localeCompare(b.date ?? "") || rank(a.code) - rank(b.code),
  );
}
