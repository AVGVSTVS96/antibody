import { mkdir, exists } from "node:fs/promises";

const root = `${import.meta.dir}/../../data/trades`;
const years = Bun.argv.slice(2).length ? Bun.argv.slice(2) : ["2024", "2025", "2026"];

type Filing = { prefix: string; last: string; first: string; suffix: string; type: string; district: string; year: string; filed: string; docId: string };

const rows: Filing[] = [];
for (const year of years) {
  const text = await Bun.file(`${root}/idx/${year}FD.txt`).text();
  for (const line of text.replace(/^﻿/, "").trim().split(/\r?\n/).slice(1)) {
    const [prefix, last, first, suffix, type, district, y, filed, docId] = line.split("\t");
    if (type === "P") rows.push({ prefix, last, first, suffix, type, district, year: y, filed, docId: docId.trim() });
  }
}

const url = (f: Filing) => `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${f.year}/${f.docId}.pdf`;
await Bun.write(`${root}/house-ptr-index.json`, JSON.stringify(rows.map((f) => ({ ...f, url: url(f) })), null, 1));

const queue = [...rows];
let ok = 0, failed = 0;
async function worker() {
  for (let f = queue.shift(); f; f = queue.shift()) {
    const dir = `${root}/house/${f.year}`;
    await mkdir(dir, { recursive: true });
    const path = `${dir}/${f.docId}.pdf`;
    if (await exists(path)) { ok++; continue; }
    const res = await fetch(url(f), { headers: { "User-Agent": "antibody research (hex-ai@agentmail.to)" } });
    if (!res.ok) { failed++; console.error(res.status, url(f)); continue; }
    await Bun.write(path, await res.arrayBuffer());
    ok++;
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
console.log({ filings: rows.length, ok, failed });
