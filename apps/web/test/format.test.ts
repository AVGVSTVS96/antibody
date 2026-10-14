import { expect, test } from "bun:test";
import { exactUsd, nice, usd } from "../src/lib/format.ts";

test("dollars under $10K keep one decimal and drop a trailing .0", () => {
  expect(usd(2500)).toBe("$2.5K");
  expect(usd(4500)).toBe("$4.5K");
  expect(usd(5000)).toBe("$5K");
  expect(usd(9960)).toBe("$10K");
  expect(usd(999)).toBe("$999");
  expect(usd(21_400)).toBe("$21K");
  expect(usd(-2500)).toBe("−$2.5K");
});

test("a donor row's parts add up to the total shown", () => {
  const parts = [3250, 1750, 2750];
  const total = parts.reduce((n, x) => n + x, 0);
  expect(parts.map(exactUsd)).toEqual(["$3,250", "$1,750", "$2,750"]);
  expect(exactUsd(total)).toBe("$7,750");
});

test("names keep of/and/the/for lowercase and known mixed-case spellings", () => {
  expect(nice("BANK OF AMERICA CORPORATION FEDERAL PAC")).toBe("Bank of America Corporation Federal PAC");
  expect(nice("WELLS FARGO AND COMPANY EMPLOYEES GOOD GOVERNMENT FUND")).toBe(
    "Wells Fargo and Company Employees Good Government Fund",
  );
  expect(nice("THE BOEING COMPANY")).toBe("The Boeing Company");
  expect(nice("FEDEX CORPORATION")).toBe("FedEx Corporation");
  expect(nice("MODERNATX, INC.")).toBe("ModernaTX, Inc.");
  expect(nice("PROCTER & GAMBLE Co")).toBe("Procter & Gamble Co");
});
