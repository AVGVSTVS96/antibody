import { norm, parseAsset, tokens } from "@antibody/resolve";

const TICKER_REUSED = [
  { ticker: "COR", asset: /^coresite\b/iu },
  { ticker: "CNR", asset: /^cornerstone\b/iu },
];

export const reusedTicker = (ticker: string | null, asset: string) =>
  TICKER_REUSED.some((r) => r.ticker === ticker?.toUpperCase() && r.asset.test(asset));

export function nameMatches(asset: string, company: string): boolean {
  const a = new Set(tokens(norm(parseAsset(asset.replaceAll("&#x27;", "'")).name)));

  return !a.size || tokens(norm(company)).some((t) => a.has(t));
}

export type Security = "stock" | "option" | "bond" | "other";

const CODE = /\[([A-Z]{2})\]\s*$/u;

const KIND = new Map<string, Security>([
  ["st", "stock"],
  ["ps", "stock"],
  ["stock", "stock"],
  ["op", "option"],
  ["stock option", "option"],
  ["cs", "bond"],
  ["corporate bond", "bond"],
]);

export function securityOf(assetType: string | null, asset: string): Security {
  const code = assetType ?? CODE.exec(asset)?.[1] ?? null;

  return code === null || code === "" ? "stock" : (KIND.get(code.toLowerCase()) ?? "other");
}
