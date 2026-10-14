import { expect, test } from "bun:test";
import { memberHref, parseRoute, routeHref, sectionHref, storyHref } from "../src/lib/router.ts";

test("every route parses back from its own link", () => {
  const routes = [
    { page: "land" },
    { page: "xray", id: "119-hr-1" },
    { page: "story", id: "119-hr-1", chapter: null },
    { page: "story", id: "119-hr-1", chapter: 4 },
    { page: "money", id: "119-hr-1", section: "119-hr-1@eas:title:I/subtitle:A/sec:10102" },
    { page: "money", id: "119-s-1582", section: "19" },
    { page: "member", id: "119-s-1582", bioguide: "H000601" },
  ] as const;
  for (const r of routes) expect(parseRoute(routeHref(r))).toEqual(r);
});

test("section ids with slashes and colons survive the URL", () => {
  const slug = "119-hr-1@eas:title:I/subtitle:A/sec:10102";
  expect(sectionHref("119-hr-1", slug)).not.toContain("subtitle:A/");
  expect(parseRoute(sectionHref("119-hr-1", slug))).toEqual({ page: "money", id: "119-hr-1", section: slug });
});

test("old map links land on the nearest new page", () => {
  expect(parseRoute("/bill/119-s-1582?view=money")).toEqual({ page: "xray", id: "119-s-1582" });
  expect(parseRoute("/bill/119-s-1582?view=list")).toEqual({ page: "xray", id: "119-s-1582" });
  expect(parseRoute("/bill/119-s-1582?focus=member:G000583")).toEqual({
    page: "member",
    id: "119-s-1582",
    bioguide: "G000583",
  });
  expect(parseRoute("/bill/119-s-1582?view=money&focus=section:119-s-1582@es:sec:19")).toEqual({
    page: "money",
    id: "119-s-1582",
    section: "19",
  });
  expect(parseRoute("/bill/119-hr-1?view=money&focus=section:119-hr-1@eas:title:VII/subtitle:A/sec:70322")).toEqual({
    page: "money",
    id: "119-hr-1",
    section: "70322",
  });
  expect(parseRoute("/bill/119-s-1582?focus=company:1403161")).toEqual({ page: "xray", id: "119-s-1582" });
});

test("a bill written the way people write it becomes its canonical id", () => {
  expect(parseRoute("/bill/S.1582")).toEqual({ page: "xray", id: "119-s-1582" });
  expect(parseRoute("/bill/hr1/story/2")).toEqual({ page: "story", id: "119-hr-1", chapter: 2 });
});

test("unknown paths and chapters are missing", () => {
  for (const p of [
    "/nowhere",
    "/bill",
    "/bill/119-hr-1/story/7",
    "/bill/119-hr-1/story/x",
    "/bill/119-hr-1/member",
    "/bill/119-hr-1/x/y",
    "/bill/%E0%A4%A",
  ])
    expect(parseRoute(p)).toEqual({ page: "missing" });
});

test("link helpers", () => {
  expect(storyHref("119-hr-1")).toBe("/bill/119-hr-1/story");
  expect(storyHref("119-hr-1", 3)).toBe("/bill/119-hr-1/story/3");
  expect(memberHref("119-hr-1", "A000375")).toBe("/bill/119-hr-1/member/A000375");
});
