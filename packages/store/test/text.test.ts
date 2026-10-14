import { expect, test } from "bun:test";
import { mcCase } from "../src/text.ts";

test("Mc- names keep their second capital", () => {
  expect(mcCase("Joint Base Mcguire-Dix-Lakehurst, New Jersey")).toBe("Joint Base McGuire-Dix-Lakehurst, New Jersey");
  expect(mcCase("Mccain-mansfield and sfc sean cooley")).toBe("McCain-mansfield and sfc sean cooley");
  expect(mcCase("McClain and Mc")).toBe("McClain and Mc");
});
