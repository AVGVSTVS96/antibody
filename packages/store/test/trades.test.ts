import { expect, test } from "bun:test";
import { securityOf } from "../src/trades.ts";

test("only shares count as stock; options and bonds are kept apart, whichever way the filing writes the type", () => {
  expect(securityOf("ST", "Visa Inc. (V) [ST]")).toBe("stock");
  expect(securityOf("Stock", "Visa Inc.")).toBe("stock");
  expect(securityOf(null, "Visa Inc. (V)")).toBe("stock");
  expect(securityOf("OP", "generac Holdlings Inc. (gNRC) [OP]")).toBe("option");
  expect(securityOf("Stock Option", "Visa Inc.")).toBe("option");
  expect(securityOf(null, "Zillow (Z) [OP]")).toBe("option");
  expect(securityOf("CS", "Ford 4.5% 2030")).toBe("bond");
  expect(securityOf("Corporate Bond", "Ford")).toBe("bond");
  expect(securityOf("Municipal Security", "City of X")).toBe("other");
});
