import type { BillStatus } from "./billstatus.ts";

export interface VersionRef {
  code: string;
  name: string;
  date: string | null;
  url: string;
  file: string;
}

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

  return i === -1 ? 4 : i;
};

function pick(urls: string[]): { url: string; file: string; code: string } | null {
  const plaw = urls.find((u) => u.includes("/uslm/PLAW-"));

  if (plaw !== undefined && plaw !== "") {
    return { url: plaw, file: versionFile(plaw), code: "plaw" };
  }

  const url = urls.find((u) => u.includes("/xml/BILLS-")) ?? urls.find((u) => u.includes("/uslm/BILLS-"));
  const code = url?.match(/BILLS-\d+[a-z]+?\d+(?<code>[a-z]+)\.xml$/u)?.groups?.code;

  if (url === undefined || url === "" || code === undefined) {
    return null;
  }

  return { url, file: versionFile(url), code };
}

export function versionFile(url: string): string {
  const name = url.slice(url.lastIndexOf("/") + 1);

  return url.includes("/uslm/BILLS-") ? `USLM-${name}` : name;
}

export function textVersions(status: BillStatus): VersionRef[] {
  const presented = status.actions.find((a) => a.text.startsWith("Presented to President"))?.date ?? null;
  const out: VersionRef[] = [];

  for (const v of status.textVersions) {
    const hit = pick(v.urls);

    if (!hit || out.some((o) => o.code === hit.code)) {
      continue;
    }

    const date = hit.code === "plaw" ? (status.lawOn ?? v.date) : hit.code === "enr" ? (v.date ?? presented) : v.date;

    const name =
      hit.code === "plaw" && status.law !== null && status.law !== ""
        ? `Public Law ${status.law.replace(/^\S+ /u, "")}`
        : v.name;

    out.push({ ...hit, name, date });
  }

  const tier = (v: VersionRef) => (v.code === "plaw" ? 2 : v.code === "enr" ? 1 : 0);

  return out.toSorted(
    (a, b) => tier(a) - tier(b) || (a.date ?? "").localeCompare(b.date ?? "") || rank(a.code) - rank(b.code),
  );
}
