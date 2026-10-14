/**
 * Publishes the fixture bundles to apps/web/public/bundles with an index, so the site renders real bills
 * before @antibody/store writes its own. Store's publish replaces these files.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Bundle, BundleIndex, billStats, checkBundle } from "@antibody/core";

const WEB = join(import.meta.dir, "..");
const FIXTURES = join(WEB, "fixtures");
const OUT = join(WEB, "public/bundles");

const bills = readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".bundle.json"))
  .map((f) => {
    const b = Bundle.parse(JSON.parse(readFileSync(join(FIXTURES, f), "utf8")));
    const problems = checkBundle(b);
    if (problems.length) throw new Error(`${f}: ${problems.join("; ")}`);
    const file = `${b.bill.id}.json`;
    writeFileSync(join(OUT, file), `${JSON.stringify(b)}\n`);
    const sponsor = b.nodes.find((n) => n.id === b.bill.sponsor);
    return {
      id: b.bill.id,
      display: b.bill.display,
      title: b.bill.title,
      shortTitle: b.bill.shortTitle,
      law: b.bill.law,
      sponsorParty: sponsor?.kind === "member" ? sponsor.props.party : null,
      latestActionOn: b.bill.lawOn ?? b.versions.at(-1)?.date ?? null,
      file,
      stats: billStats(b),
    };
  });

const index = BundleIndex.parse({ generatedAt: new Date().toISOString(), bills, watch: [] });
writeFileSync(join(OUT, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
console.log(`published ${bills.length} bundles to ${OUT}`);
