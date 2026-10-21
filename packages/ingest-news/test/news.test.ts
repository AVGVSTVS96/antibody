import { expect, test } from "bun:test";
import { parseRss } from "../src/gnews.ts";
import { defaultTerms, sample } from "../src/news.ts";
import { COUNTED, midpoint, OUTLET_LIST, outletFor, outletRows, SIDES, sideOf, TRADE_LEGAL } from "../src/outlets.ts";

test("a multi-quintile outlet takes the midpoint, rounded toward center, the same way on both sides", () => {
  expect(midpoint(["left", "center-left"])).toBe("center-left");
  expect(midpoint(["center-right", "right"])).toBe("center-right");
  expect(midpoint(["left", "center"])).toBe("center-left");
  expect(midpoint(["center", "right"])).toBe("center-right");
  expect(midpoint(["left", "center-left", "center", "center-right"])).toBe("center");
  expect(midpoint(["center-left", "center", "center-right", "right"])).toBe("center");
  expect(midpoint(["left", "left", "center-left", "center"])).toBe("center-left");
  expect(midpoint(["left", "right"])).toBe("center");
  expect(midpoint([])).toBeNull();
});

test("the published list has every side, and trade/legal press is never on a side", () => {
  for (const side of Object.keys(SIDES) as (keyof typeof SIDES)[])
    expect(COUNTED.filter((o) => sideOf(o.group) === side).length).toBeGreaterThan(0);
  for (const o of TRADE_LEGAL) expect(sideOf(o.group)).toBeNull();
  expect(outletRows().every((r) => r.list_version === OUTLET_LIST.version)).toBe(true);
});

test("outlets match by domain, ignoring www. and subdomains", () => {
  expect(outletFor("https://www.foxnews.com/politics/x")?.domain).toBe("foxnews.com");
  expect(outletFor("https://edition.cnn.com/2025/x")?.domain).toBe("cnn.com");
  expect(outletFor("nytimes.com")?.domain).toBe("nytimes.com");
  expect(outletFor("https://example.org/x")).toBeNull();
});

test("Google News RSS items parse with their source outlet", () => {
  const xml = `<rss><channel><item><title>Senate passes GENIUS Act - Fox News</title><link>https://news.google.com/rss/articles/abc?oc=5</link><pubDate>Tue, 17 Jun 2025 20:00:00 GMT</pubDate><source url="https://www.foxnews.com">Fox News</source></item></channel></rss>`;
  const [it] = parseRss(xml);
  expect(it).toEqual({
    title: "Senate passes GENIUS Act",
    link: "https://news.google.com/rss/articles/abc?oc=5",
    published: "2025-06-17",
    sourceName: "Fox News",
    sourceUrl: "https://www.foxnews.com",
  });
});

test("the sample is a fixed number per side, picked by hash, so re-runs read the same articles", () => {
  const items = Array.from({ length: 1000 }, (_, i) => ({
    id: `a${i}`,
    stratum: (["left", "center", "right", "trade-legal"] as const)[i % 4]!,
  }));
  const a = sample(items).map((x) => x.id);
  const b = sample([...items].reverse()).map((x) => x.id);
  expect(new Set(a)).toEqual(new Set(b));
  expect(a.length).toBe(150 * 3 + 60);
});

test("the default search drops the year from a short title and spaces the bill number", () => {
  expect(defaultTerms("Romance Scam Prevention Act of 2025", "H.R.2481")).toEqual([
    '"Romance Scam Prevention Act"',
    '"H.R. 2481"',
  ]);
  expect(defaultTerms("Small LENDER Act", "H.R.941")).toEqual(['"Small LENDER Act"', '"H.R. 941"']);
  expect(defaultTerms(null, "S.195")).toEqual(['"S. 195"']);
  expect(defaultTerms(null, "H.J.Res.88")).toEqual(['"H.J.Res. 88"', '"H.J. Res. 88"']);
  expect(defaultTerms("Secure America Act", "S.2")).toEqual(['"Secure America Act"']);
  expect(defaultTerms(null, "S.2")).toEqual(['"S. 2"']);
});
