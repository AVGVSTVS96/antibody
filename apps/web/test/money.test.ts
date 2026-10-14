import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Bundle } from "@antibody/core";
import genius from "../fixtures/119-s-1582.bundle.json";
import { buildModel } from "../src/lib/model.ts";
import { pacName } from "../src/lib/pac.ts";
import { tiedDonors } from "../src/lib/trades.ts";
import { billTies, clientLines, ledger, sectionTies } from "../src/money/ties.ts";

const dir = join(import.meta.dir, "../public/bundles");
const published = existsSync(dir) ? readdirSync(dir).filter((f) => /^\d+-[a-z]+-\d+\.json$/.test(f)) : [];

test("a tied PAC donor that netted $0 or less is returned money, never a donor", () => {
  const b = Bundle.parse(structuredClone(genius));
  const funded = b.edges.filter((e) => e.kind === "funded");
  expect(funded.length).toBeGreaterThan(2);
  funded[0]!.props.amountUsd = 0;
  funded[1]!.props.amountUsd = -500;
  const m = buildModel(b);
  const out = m.members.map((mv) => tiedDonors(mv));
  expect(out.flatMap((d) => d.given).every((f) => f.edge.props.amountUsd > 0)).toBe(true);
  expect(out.flatMap((d) => d.returned).map((f) => f.edge.id)).toEqual(
    expect.arrayContaining([funded[0]!.id, funded[1]!.id]),
  );
  expect(out.reduce((n, d) => n + d.given.length + d.returned.length, 0)).toBe(funded.length);
});

describe.skipIf(published.length === 0)("every published bundle", () => {
  for (const file of published)
    test(`${file}: the largest-donors list holds only net-positive donors, with no inverted span`, () => {
      const m = buildModel(Bundle.parse(JSON.parse(readFileSync(join(dir, file), "utf8"))));
      for (const mv of m.members) {
        const { given, returned } = tiedDonors(mv);
        expect(given.length + returned.length).toBe(mv.funded.length);
        for (const f of given) expect(f.edge.props.amountUsd).toBeGreaterThan(0);
        for (const f of returned) expect(f.edge.props.amountUsd).toBeLessThanOrEqual(0);
        if (given.length) expect(given.reduce((n, f) => n + f.edge.props.amountUsd, 0)).toBeGreaterThan(0);
      }
    });

  test("no PAC name from any bundle shows an unclosed parenthesis", () => {
    for (const file of published) {
      const b = Bundle.parse(JSON.parse(readFileSync(join(dir, file), "utf8")));
      for (const n of b.nodes) if (n.kind === "pac") expect(pacName(n.label)).not.toMatch(/\([^)]*$/);
    }
  });

  test("clients that merge into one company are one ledger row listing each name once", () => {
    const m = buildModel(Bundle.parse(JSON.parse(readFileSync(join(dir, "119-hr-1.json"), "utf8"))));
    const ties = billTies(m);
    const rows = ledger(m, ties);
    expect(rows.length).toBeLessThan(ties.length);
    expect(rows.reduce((n, r) => n + r.ties.length, 0)).toBe(ties.length);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    const jp = rows.find((r) => r.company?.ticker === "JPM")!;
    const names = clientLines(jp.ties).map((l) => l.name.toLowerCase().replace(/\s/g, ""));
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(1);
    const jnj = rows.find((r) => r.company?.ticker === "JNJ")!;
    const [only] = clientLines(jnj.ties);
    expect(clientLines(jnj.ties)).toHaveLength(1);
    expect(only!.reports).toBe(jnj.ties.reduce((n, t) => n + t.edge.props.reports, 0));
    expect(only!.quarters).toBeNull();
  });

  test("a section's ledger lists every client drawn for it, and the reports are its drawn count", () => {
    const m = buildModel(Bundle.parse(JSON.parse(readFileSync(join(dir, "119-hr-1.json"), "utf8"))));
    const v = m.sectionBySlug("70322")!;
    const ties = sectionTies(m, v);
    expect(ledger(m, ties).reduce((n, r) => n + r.ties.length, 0)).toBe(ties.length);
    expect(ties.reduce((n, t) => n + t.edge.props.reports, 0)).toBe(v.drawn);
    expect(v.named).toBeGreaterThanOrEqual(v.drawn);
  });
});

test("a PAC shows the short name its FEC record gives, never cut", () => {
  expect(pacName("NIKE INC FEDERAL POLITICAL ACTION COMMITTEE (NIKE FEDERAL PAC)")).toBe("Nike Federal PAC");
  expect(pacName("EDWARDS LIFESCIENCES POLITICAL ACTION COMMITTEE (A.K.A. EDWARDS PAC)")).toBe("Edwards PAC");
  expect(pacName("ERICSSON INC. U.S. EMPLOYEES POLITICAL ACTION COMMITTEE ('ERICSSON PAC')")).toBe("Ericsson PAC");
  expect(pacName("CATERPILLAR INC. POLITICAL ACTION COMMITTEE (CATPAC)")).toBe("CATPAC");
  expect(pacName("JOHN HANCOCK LIFE INSURANCE COMPANY (USA) FEDERAL POLITICAL ACTION COMMITTEE")).toContain("(USA)");
  expect(pacName("FORD MOTOR COMPANY CIVIC ACTION FUND")).toBe("Ford Motor Company Civic Action Fund");
  expect(
    pacName("FEDERAL BIPARTISAN VOLUNTARY PUBLIC AFFAIRS COMMITTEE OF THE PNC FINANCIAL SERVICES GROUP, INC. (PNC"),
  ).not.toContain("(");
  expect(pacName("FRANKLIN RESOURCES, INC. POLITICAL ACTION COMMITTEE (FRANKLIN TEMPLETON PAC")).toBe(
    "Franklin Templeton PAC",
  );
});
