import type { Row } from "@antibody/core";
import type { Mention } from "./match.ts";

export function clientMentions(clients: Row<"lda_clients">[]): Mention[] {
  return clients.map((c) => ({
    src: `client:${c.id}`,
    source: "client",
    name: c.name,
    ticker: null,
    context:
      [
        c.names
          .filter((n) => n !== c.name)
          .slice(0, 4)
          .join("; "),
        c.description,
      ]
        .filter(Boolean)
        .join(" | ") || null,
    restsOn: [`lda_clients/${c.id}`],
  }));
}

/** Committee types that are candidates' own committees or party committees, never a company's PAC. */
const NOT_SPONSORED = new Set(["H", "S", "P", "X", "Y", "Z"]);

/**
 * PACs with a connected organization. Leadership PACs (designation D) are left out: their "connected org" is the
 * politician's surname, which matched Williams Companies and McCormick & Co in the spike.
 */
export function pacMentions(pacs: Row<"pacs">[]): Mention[] {
  return pacs
    .filter((p) => p.designation !== "D" && !NOT_SPONSORED.has(p.type ?? ""))
    .map((p) => {
      const org = p.connected_org && !/^(NONE|N\/?A|NULL)$/i.test(p.connected_org.trim()) ? p.connected_org : null;
      return {
        src: `pac:${p.id}`,
        source: "pac" as const,
        name: org ?? p.name,
        ticker: null,
        context: org ? `PAC name: ${p.name}` : null,
        restsOn: [`pacs/${p.id}`],
      };
    });
}

/** Stock and options only; bonds, funds and notes stay out of the headline (decision weak-tier-assets). */
export const STOCK_TYPES = new Set(["ST", "OP", "Stock", "Stock Option"]);

export function tradeMentions(trades: Row<"trades">[]): Mention[] {
  return trades
    .filter((t) => STOCK_TYPES.has(t.asset_type ?? "") || (t.asset_type === null && t.ticker))
    .map((t) => ({
      src: `trade:${t.id}`,
      source: "trade" as const,
      name: t.asset,
      ticker: t.ticker,
      context: null,
      restsOn: [`trades/${t.id}`],
    }));
}

/** Rows of one entity can arrive in several shards (one per bill); each src is resolved once. */
export const uniqueBySrc = (mentions: Mention[]) => [...new Map(mentions.map((m) => [m.src, m])).values()];

/**
 * Trades repeat the same asset hundreds of times; resolve each distinct (name, ticker) once and fan the answer out.
 */
export function dedupe(mentions: Mention[]): { unique: Mention[]; fanOut: Map<Mention, Mention[]> } {
  const groups = new Map<string, Mention[]>();
  for (const m of mentions) {
    const k = `${m.source}\u0000${m.name}\u0000${m.ticker ?? ""}\u0000${m.context ?? ""}`;
    const g = groups.get(k);
    if (g) g.push(m);
    else groups.set(k, [m]);
  }
  const fanOut = new Map<Mention, Mention[]>();
  for (const g of groups.values()) fanOut.set(g[0]!, g);
  return { unique: [...fanOut.keys()], fanOut };
}
