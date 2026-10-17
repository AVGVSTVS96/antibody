import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLAIM_TEXT_RULES, RULES, ruleFor } from "../src/rules.ts";

const docs = readFileSync(join(import.meta.dir, "../../../docs/rules.md"), "utf8");
const headings = new Set([...docs.matchAll(/^## (.+)$/gm)].map((m) => m[1]));

test("every published rule has a heading in docs/rules.md and a link that lands on it", () => {
  for (const id of [...Object.keys(RULES), ...CLAIM_TEXT_RULES]) {
    expect(headings.has(id)).toBe(true);
    const r = ruleFor(id === "buried-v3" || id === "attention-v1" || id === "quiet-check-v1" ? `${id}: text` : id);
    expect(r.url?.endsWith(`docs/rules.md#${id}`)).toBe(true);
  }
});

test("a rule's text is not its id", () => {
  for (const id of Object.keys(RULES)) expect(ruleFor(id).text.toLowerCase()).not.toBe(id);
});
