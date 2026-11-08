import type { Row } from "@antibody/core";
import { filled } from "@antibody/core";
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

const LEADERSHIP_PAC = "D";
const CANDIDATE_OR_PARTY_COMMITTEE = new Set(["H", "S", "P", "X", "Y", "Z"]);

export function pacMentions(pacs: Row<"pacs">[]): Mention[] {
  return pacs.flatMap((p) => {
    if (p.designation === LEADERSHIP_PAC || CANDIDATE_OR_PARTY_COMMITTEE.has(p.type ?? "")) {
      return [];
    }

    const org =
      filled(p.connected_org) && !/^(NONE|N\/?A|NULL)$/iu.test(p.connected_org.trim()) ? p.connected_org : null;

    return [
      {
        src: `pac:${p.id}`,
        source: "pac" as const,
        name: org ?? p.name,
        ticker: null,
        context: org === null ? null : `PAC name: ${p.name}`,
        restsOn: [`pacs/${p.id}`],
      },
    ];
  });
}

export const EMPLOYER_REVIEW_USD = 25_000;

export function employerMentions(
  rows: Pick<Row<"employer_contributions">, "id" | "employer" | "employer_key" | "amount_usd">[],
): Mention[] {
  interface Employer {
    usd: number;
    spellings: Map<string, number>;
    ids: string[];
  }

  const by = new Map<string, Employer>();

  for (const r of rows) {
    const e: Employer = by.get(r.employer_key) ?? { usd: 0, spellings: new Map(), ids: [] };
    e.usd += r.amount_usd;
    e.spellings.set(r.employer, (e.spellings.get(r.employer) ?? 0) + r.amount_usd);
    e.ids.push(r.id);
    by.set(r.employer_key, e);
  }

  return [...by].map(([key, e]) => {
    const [name, ...aka] = [...e.spellings].toSorted((a, b) => b[1] - a[1]).map(([n]) => n);

    if (name === undefined) {
      throw new Error(`employer ${key} has no spelling`);
    }

    return {
      src: `employer:${key}`,
      source: "employer" as const,
      name,
      ticker: null,
      context: aka.length
        ? `employer of individual donors, also written: ${aka.slice(0, 4).join("; ")}`
        : "employer of individual donors",
      restsOn: e.ids.slice(0, 5).map((id) => `employer_contributions/${id}`),
      reviewable: e.usd >= EMPLOYER_REVIEW_USD,
    };
  });
}

export const STOCK_TYPES = new Set(["ST", "OP", "Stock", "Stock Option"]);

export function tradeMentions(trades: Row<"trades">[]): Mention[] {
  return trades.flatMap((t) =>
    STOCK_TYPES.has(t.asset_type ?? "") || (t.asset_type === null && filled(t.ticker))
      ? [
          {
            src: `trade:${t.id}`,
            source: "trade" as const,
            name: t.asset,
            ticker: t.ticker,
            context: null,
            restsOn: [`trades/${t.id}`],
          },
        ]
      : [],
  );
}

export const uniqueBySrc = (mentions: Mention[]) => [...new Map(mentions.map((m) => [m.src, m])).values()];

export function dedupe(mentions: Mention[]) {
  const firstByKey = new Map<string, Mention>();
  const fanOut = new Map<Mention, Mention[]>();

  for (const m of mentions) {
    const k = `${m.source}\u0000${m.name}\u0000${m.ticker ?? ""}\u0000${m.context ?? ""}`;
    const first = firstByKey.get(k);

    if (first === undefined) {
      firstByKey.set(k, m);
      fanOut.set(m, [m]);
    } else {
      fanOut.get(first)?.push(m);
    }
  }

  return { unique: [...fanOut.keys()], fanOut };
}
