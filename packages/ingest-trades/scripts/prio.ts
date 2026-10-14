import { readRows } from "@antibody/core/node";
const inv = new Set((await readRows("sponsorships")).map((s) => s.bioguide));
const docs = await readRows("ptr_documents");
const un = docs.filter((d) => d.read_status !== "read" && d.scanned);
const pr = un.filter((d) => d.bioguide && inv.has(d.bioguide));
console.log("involved members", inv.size, "scanned docs not fully read", un.length, "of those priority", pr.length);
console.log(Object.groupBy(pr, (d) => d.read_status) && Object.fromEntries(Object.entries(Object.groupBy(pr, (d) => d.read_status)).map(([k, v]) => [k, v!.length])));
console.log("pages priority", pr.reduce((a, d) => a + (d.pages ?? 0), 0), "pages all", un.reduce((a, d) => a + (d.pages ?? 0), 0));
