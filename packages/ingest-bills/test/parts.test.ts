import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBillStatus } from "../src/billstatus.ts";
import { trace } from "../src/lineage.ts";
import { PARTS, sectionParts, splitSection } from "../src/parts.ts";
import { parseSections, sectionElements, sectionNum } from "../src/sections.ts";
import { textVersions } from "../src/versions.ts";

const words = (seed: string, n: number) => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ");
const bill = (body: string) => `<?xml version="1.0"?><bill><legis-body>${body}</legis-body></bill>`;
const sub = (tag: string, en: string, head: string, inner: string) =>
  `<${tag}><enum>${en}</enum>${head ? `<header>${head}</header>` : ""}${inner}</${tag}>`;
const el = (xml: string) => sectionElements(xml)[0]!.el;

describe("splitSection", () => {
  test("a short section is read whole", () => {
    const xml = bill(`<section><enum>1.</enum><header>Short</header><text>${words("w", 450)}</text></section>`);
    expect(splitSection(el(xml))).toEqual([]);
  });

  test("a long section splits into its subsections, and a subsection still too long into its paragraphs", () => {
    const big = sub(
      "subsection",
      "(a)",
      "Standards",
      `<text>Each issuer shall—</text>${sub("paragraph", "(1)", "In general", `<text>${words("a", 700)}</text>`)}${sub(
        "paragraph",
        "(2)",
        "Prohibition on interest",
        `<text>No issuer shall pay interest. ${words("b", 30)}</text>`,
      )}${sub("paragraph", "(3)", "Reserves", `<text>${words("c", 400)}</text>`)}`,
    );
    const xml = bill(
      `<section><enum>4.</enum><header>Requirements</header>${big}${sub("subsection", "(b)", "Rulemaking", `<text>${words("d", 200)}</text>`)}</section>`,
    );
    const parts = splitSection(el(xml));
    expect(parts.map((p) => [p.enum, p.heading, p.trail, p.path, p.leadIn])).toEqual([
      ["(a)(1)", "In general", ["Standards"], "subsection:a/paragraph:1", false],
      ["(a)(2)", "Prohibition on interest", ["Standards"], "subsection:a/paragraph:2", false],
      ["(a)(3)", "Reserves", ["Standards"], "subsection:a/paragraph:3", false],
      ["(b)", "Rulemaking", [], "subsection:b", false],
    ]);
    expect(parts[1]!.text).toStartWith("No issuer shall pay interest.");
  });

  test("a split piece's own words of 40 or more are a part of their own; USLM num and heading read the same", () => {
    const lead = words("lead", PARTS.leadInMin);
    const xml = `<?xml version="1.0"?><bill><main><section><num>Sec. 9.</num><heading>Law</heading><chapeau>${lead}</chapeau>${sub(
      "subsection",
      "(a)",
      "",
      `<content>${words("x", 600)}</content>`,
    ).replace(/<enum>\(a\)<\/enum>/, '<num value="a">(a)</num><heading>First.—</heading>')}${sub(
      "subsection",
      "(b)",
      "",
      `<content>${words("y", 600)}</content>`,
    ).replace(/<enum>\(b\)<\/enum>/, '<num value="b">(b)</num>')}</section></main></bill>`;
    const parts = splitSection(el(xml));
    expect(parts.map((p) => [p.enum, p.heading, p.leadIn, p.words])).toEqual([
      ["", "", true, PARTS.leadInMin],
      ["(a)", "First", false, 600],
      ["(b)", "", false, 600],
    ]);
  });

  test("text quoted into other law stays inside the piece that inserts it", () => {
    const inserted = `<quoted-block>${sub("subsection", "(x)", "Inserted", `<text>${words("q", 1500)}</text>`)}${sub("subsection", "(y)", "Also", `<text>${words("r", 10)}</text>`)}</quoted-block>`;
    const xml = bill(
      `<section><enum>5.</enum><header>Amendments</header>${sub("subsection", "(a)", "In general", `<text>Section 1 is amended by adding:</text>${inserted}`)}${sub("subsection", "(b)", "Date", `<text>${words("z", 20)}</text>`)}</section>`,
    );
    expect(splitSection(el(xml)).map((p) => [p.enum, p.words > 1500])).toEqual([
      ["(a)", true],
      ["(b)", false],
    ]);
  });
});

/** Real GovInfo texts of S.1582 (GENIUS Act) and its predecessor S.394. */
const fixture = (name: string) =>
  new TextDecoder().decode(Bun.gunzipSync(readFileSync(join(import.meta.dir, "fixtures", `${name}.gz`))));

describe("GENIUS Act, read in parts", async () => {
  const status = parseBillStatus(fixture("BILLSTATUS-119s1582.xml"), "119-s-1582");
  const pred = {
    code: "s394-is",
    url: "https://www.govinfo.gov/content/pkg/BILLS-119s394is/xml/BILLS-119s394is.xml",
    file: "BILLS-119s394is.xml",
  };
  const refs = [pred, ...textVersions(status)];
  const versions = refs.map((r, i) => ({ code: r.code, predecessor: i === 0, secs: parseSections(fixture(r.file)) }));
  const { lineages } = trace("119-s-1582", versions);
  const final = versions.at(-1)!.code;
  const sections = lineages.map((l) => ({
    id: l.id,
    num: sectionNum(l.last.path),
    in_final: l.lastVersion === final,
    words: l.last.words,
    history: l.history,
    split_from: l.splitFrom?.id ?? null,
    first_version: l.firstVersion,
  }));
  const files = new Map(refs.map((r) => [r.url, r.file]));
  const parts = await sectionParts(
    sections,
    refs.map((r, i) => ({ code: r.code, url: r.url, predecessor_rule: i === 0 ? "predecessor" : null })),
    { read: async (url) => fixture(files.get(url)!) },
  );
  const sec4 = lineages.find((l) => sectionNum(l.last.path) === "4")!;
  const part = (num: string) => parts.find((p) => p.num === num)!;

  test("section 4 (5,811 words in the law) is one lineage, already in the predecessor bill", () => {
    expect([sec4.firstVersion, sec4.last.words]).toEqual(["s394-is", 5811]);
    expect(sec4.removedIn).toBeNull();
  });

  test("its parts are its paragraphs and subsections, read from the public law", () => {
    const of4 = parts.filter((p) => p.sectionId === sec4.id);
    expect(of4.map((p) => p.num)).toEqual([
      ...Array.from({ length: 14 }, (_, i) => `4(a)(${i + 1})`),
      ...["b", "c", "d", "e", "f", "g", "h", "i"].map((l) => `4(${l})`),
    ]);
    expect(of4.every((p) => p.version === "plaw" && p.words <= PARTS.pieceOver)).toBe(true);
  });

  test("the interest ban and the Big Tech ban were written into section 4 on the Senate floor", () => {
    // Reported as the "yield loophole" fight (the ban reaches issuers only) and as the Senate's Big Tech bar.
    expect([part("4(a)(11)").heading, part("4(a)(11)").firstVersion, part("4(a)(11)").late]).toEqual([
      "Prohibition on interest",
      "es",
      true,
    ]);
    expect(part("4(a)(11)").text).toContain(
      "shall pay the holder of any payment stablecoin any form of interest or yield",
    );
    expect([part("4(a)(12)").heading, part("4(a)(12)").firstVersion, part("4(a)(12)").late]).toEqual([
      "Non-financial services public companies",
      "es",
      true,
    ]);
    expect(part("2(27)").heading).toBe("Stablecoin certification review committee");
    expect(part("2(27)").late).toBe(true);
  });

  test("parts already in the committee text or the predecessor bill are not late", () => {
    expect([part("4(a)(1)").firstVersion, part("4(a)(1)").late]).toEqual(["pcs", false]);
    expect([part("4(a)(3)").firstVersion, part("4(a)(3)").late]).toEqual(["s394-is", false]);
    expect(parts.filter((p) => p.late).map((p) => p.num)).toEqual([
      "2(27)",
      "3(c)",
      "3(d)",
      "4(a)(11)",
      "4(a)(12)",
      "4(a)(13)",
      "6(c)",
      "11(a)",
      "11(h)",
      "16(d)",
      "16(e)",
      "18(d)",
      "8(d)",
    ]);
  });

  test("late flags are withheld when the bill's are", async () => {
    const withheld = await sectionParts(
      sections,
      refs.map((r, i) => ({ code: r.code, url: r.url, predecessor_rule: i === 0 ? "predecessor" : null })),
      { read: async (url) => fixture(files.get(url)!), lateUnavailable: "rewritten wholesale" },
    );
    expect(withheld.some((p) => p.late)).toBe(false);
    expect(withheld.length).toBe(parts.length);
  });
});
