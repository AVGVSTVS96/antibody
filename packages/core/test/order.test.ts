import { expect, test } from "bun:test";
import { compareBillPath, inBillOrder } from "../src/order.ts";

const sorted = (paths: string[]) => inBillOrder(paths.map((path) => ({ path }))).map((s) => s.path);

test("titles are Roman numerals, sections count as numbers", () => {
  expect(sorted(["title:X/sec:1001", "title:IV/sec:4001", "title:IX/sec:9001", "title:II/sec:2001"])).toEqual([
    "title:II/sec:2001",
    "title:IV/sec:4001",
    "title:IX/sec:9001",
    "title:X/sec:1001",
  ]);
  expect(sorted(["sec:10", "sec:9", "sec:100"])).toEqual(["sec:9", "sec:10", "sec:100"]);
});

test("divisions run A to Z, then AA", () => {
  expect(sorted(["division:AA/sec:1", "division:B/sec:1", "division:Z/sec:1", "division:A/sec:1"])).toEqual([
    "division:A/sec:1",
    "division:B/sec:1",
    "division:Z/sec:1",
    "division:AA/sec:1",
  ]);
});

test("the same section number in two divisions keeps the divisions' order", () => {
  expect(sorted(["division:C/title:I/sec:101", "division:A/title:II/sec:101", "division:A/title:I/sec:101"])).toEqual([
    "division:A/title:I/sec:101",
    "division:A/title:II/sec:101",
    "division:C/title:I/sec:101",
  ]);
});

test("front matter comes before the containers, and subtitles before chapters", () => {
  expect(sorted(["title:I/subtitle:A/sec:11", "sec:2", "title:I/sec:10", "sec:1"])).toEqual([
    "sec:1",
    "sec:2",
    "title:I/sec:10",
    "title:I/subtitle:A/sec:11",
  ]);
  expect(compareBillPath("title:I/subtitle:A/chapter:1/sec:5", "title:I/subtitle:A/part:1/sec:4")).toBeLessThan(0);
});

test("parts inside a subchapter are Roman numerals too", () => {
  expect(sorted(["title:VII/chapter:3/part:V/sec:70354", "title:VII/chapter:3/part:II/sec:70321"])).toEqual([
    "title:VII/chapter:3/part:II/sec:70321",
    "title:VII/chapter:3/part:V/sec:70354",
  ]);
});
