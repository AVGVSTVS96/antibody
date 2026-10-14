import { expect, test } from "bun:test";
import { type Aliases, acronyms, best, findRefs, matcher, nameForms, period, sectionNums } from "../src/extract.ts";
import { searchTerms } from "../src/pull.ts";

const genius: Aliases = {
  bill: "119-s-1582",
  congress: 119,
  numbers: [
    { id: "119-s-1582", introduced: "2025-05-01", why: "own" },
    { id: "119-s-394", introduced: "2025-02-04", why: "same title" },
    { id: "119-s-919", introduced: "2025-03-10", why: "same title" },
  ],
  names: [
    { text: "GENIUS Act", title: "GENIUS Act", level: "high", since: "2025-02-04", why: "short title" },
    {
      text: "Guiding and Establishing National Innovation for U.S. Stablecoins",
      title: "Guiding and Establishing National Innovation for U.S. Stablecoins Act",
      level: "high",
      since: "2025-02-04",
      why: "short title",
    },
  ],
  laws: ["119-27"],
  introduced: "2025-02-04",
  enactedOn: "2025-07-18",
  rivals: ["A. Donald McEachin Environmental Justice for All"],
  support: [],
  years: [2025, 2026],
};

const obbba: Aliases = {
  bill: "119-hr-1",
  congress: 119,
  numbers: [{ id: "119-hr-1", introduced: "2025-05-20", why: "own" }],
  names: [
    {
      text: "One Big Beautiful Bill",
      title: "One Big Beautiful Bill Act",
      level: "high",
      since: "2025-05-20",
      why: "short title",
    },
  ],
  laws: ["119-21"],
  introduced: "2025-05-20",
  enactedOn: "2025-07-04",
  rivals: ["Tax Cuts and Jobs", "115-97", "For the People", "Lower Energy Costs"],
  support: ["reconciliation", "H.Con.Res.14"],
  years: [2025, 2026],
};

const G = matcher(genius);
const O = matcher(obbba);
const level = (text: string, m = G, p = period(2026, "first_quarter")) => best(findRefs(text, p, m))?.level ?? null;

test("names, numbers and public laws as filed (spike + verifier samples)", () => {
  expect(level("S.1582/P.L.119-27, the GENIUS Act")).toBe("high");
  expect(level("S. 394, GENIUS Act of 2025", G, period(2025, "first_quarter"))).toBe("high");
  expect(level("Issues related to stablecoins; S. 1582")).toBe("medium");
  expect(level("Advocating on the Genius Act of 2025")).toBe("high");
  expect(level("Guiding and Establishing National Innovation for US Stablecoins Act")).toBe("high");
  expect(level("P.L. 119-27 implementation")).toBe("high");
});

test("typos of a long all-caps title still match", () => {
  expect(level("S.394 GENUIS Act; H.R. 2392 STABLE Act", G, period(2025, "second_quarter"))).toBe("high");
});

test("a number reused by another bill in the clause is held out", () => {
  expect(level("S. 919 A. Donald McEachin Environmental Justice for All Act", G, period(2025, "second_quarter"))).toBe(
    "low",
  );
  expect(level("H.R. 1, Lower Energy Costs Act", O, period(2025, "third_quarter"))).toBe("low");
});

test("another Congress, a split number, or a period before the bill existed is held out", () => {
  expect(level("H.R. 1", O, period(2023, "first_quarter"))).toBe("low");
  expect(level("H.R.1 492 stuff", O, period(2025, "third_quarter"))).toBe("low");
  expect(level("H.R. 1 (115th Congress)", O, period(2025, "third_quarter"))).toBe("low");
  expect(level("S. 1582", G, period(2025, "first_quarter"))).toBe("low");
});

test("before introduction the same name meant an agenda, for every party alike", () => {
  expect(level("the One Big Beautiful Bill", O, period(2025, "first_quarter"))).toBe("low");
  expect(level("the One Big Beautiful Bill", O, period(2025, "third_quarter"))).toBe("high");
  expect(level("One, Big, Beautiful Bill reconciliation", O, period(2025, "third_quarter"))).toBe("high");
});

test("acronyms: full is high, without Act medium; reconciliation supports a bare H.R. 1", () => {
  expect(acronyms("One Big Beautiful Bill Act")).toEqual(["OBBBA", "OBBB"]);
  expect(acronyms("Inflation Reduction Act")).toEqual([]);
  expect(level("OBBBA tax provisions", O, period(2025, "third_quarter"))).toBe("high");
  expect(level("OBBB tax provisions", O, period(2025, "third_quarter"))).toBe("medium");
  expect(level("H.R. 1, reconciliation bill", O, period(2025, "third_quarter"))).toBe("high");
  expect(level("H.R. 1", O, period(2025, "third_quarter"))).toBe("medium");
});

test("a filer's 'companion bill' of another named Act is held out; hyphenated names still match", () => {
  const laken = matcher({
    ...genius,
    bill: "119-s-5",
    numbers: [{ id: "119-s-5", introduced: "2025-01-06", why: "own" }],
    names: [
      { text: "Laken Riley Act", title: "Laken Riley Act", level: "high", since: "2025-01-03", why: "short title" },
    ],
    laws: ["119-1"],
    rivals: [],
  });
  const p = period(2025, "first_quarter");
  expect(level("H.R. 471, Fix Our Forests Act (and companion bill S. 5); all provisions", laken, p)).toBe("low");
  expect(level("NETWORK opposed S. 5, the Laken-Riley Act.", laken, p)).toBe("high");
  expect(level("NETWORK opposed S. 5, the Laken-Riley Bill.", laken, p)).toBe("medium");
  expect(level("budget reconciliation process. (HR 1, PL 119-1) Met with staff", laken, p)).toBe("low");
  expect(level("Laken Riley Act, PL 119-1", laken, p)).toBe("high");
});

test("a possessive s is not a Senate bill", () => {
  expect(findRefs("America's 1582 farms", period(2025, "third_quarter"), G)).toEqual([]);
});

test("section numbers for this bill, not for other laws", () => {
  expect(sectionNums("Section 71120 of H.R. 1, An Act to provide for reconciliation", O)).toEqual(["71120"]);
  expect(sectionNums("H.R. 1: Secs. 70301, 70302 and 70303 (bonus depreciation)", O)).toEqual([
    "70301",
    "70302",
    "70303",
  ]);
  expect(sectionNums("H.R. 1, Section 45Y of the Internal Revenue Code", O)).toEqual([]);
  expect(sectionNums("H.R. 1, section 1202 IRC", O)).toEqual([]);
  expect(sectionNums("(H.R.1 - Sections 70301, 70521)", O)).toEqual(["70301", "70521"]);
  expect(sectionNums("Oppose Section 112025 in H.R.1 and Section 199A", O)).toEqual(["112025"]);
  expect(sectionNums("provisions in Section 70402 of the One Big Beautiful Bill Act", O)).toEqual(["70402"]);
  expect(sectionNums("Section 70101 of H.R. 2392 and the One Big Beautiful Bill", O)).toEqual([]);
});

test("a section next to an earlier bill with the same title, or a different law, is not this bill's", () => {
  const text =
    "S. 394 - Guiding and Establishing National Innovation for U.S. Stablecoins of 2025: custodians (Sec.8(b)(2)).";
  expect(sectionNums(text, G)).toEqual([]);
  expect(sectionNums("digital assets and the GENIUS Act - Section 16(a), Foreign Private Issuer", G)).toEqual([]);
  expect(sectionNums("Section 4 of the GENIUS Act (reserves)", G)).toEqual(["4"]);
  expect(sectionNums("S.1582, Sec. 4 (payment stablecoin issuers)", G)).toEqual(["4"]);
});

test("name forms drop the year, and Act when three words remain", () => {
  expect(nameForms("GENIUS Act of 2025")).toEqual(["GENIUS Act"]);
  expect(nameForms("One Big Beautiful Bill Act")).toEqual(["One Big Beautiful Bill"]);
  expect(nameForms("Inflation Reduction Act of 2022")).toEqual(["Inflation Reduction Act"]);
});

test("search terms cover number spellings, names, typos and the law", () => {
  const t = searchTerms(genius);
  for (const s of ['"S. 394"', '"S.1582"', '"GENIUS Act"', '"GENUIS Act"', '"119-27"']) expect(t).toContain(s);
  expect(searchTerms(obbba)).toContain('"OBBBA"');
});
