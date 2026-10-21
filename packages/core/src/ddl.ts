import { z } from "zod";
import { TABLES, type TableName } from "./tables.ts";

type JsonSchema = {
  type?: string | string[];
  format?: string;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
};

function sqlType(s: JsonSchema): { type: string; nullable: boolean } {
  if (Array.isArray(s.type)) {
    const types = s.type.filter((t) => t !== "null");
    const one = types.length === 1 ? sqlType({ ...s, type: types[0] }) : { type: "JSON" };
    return { type: one.type, nullable: types.length < s.type.length };
  }
  if (s.anyOf) {
    const nonNull = s.anyOf.filter((x) => x.type !== "null");
    if (nonNull.length !== 1) return { type: "JSON", nullable: true };
    return { type: sqlType(nonNull[0]!).type, nullable: nonNull.length < s.anyOf.length };
  }
  switch (s.type) {
    case "string":
      if (s.format === "date") return { type: "DATE", nullable: false };
      if (s.format === "date-time") return { type: "TIMESTAMPTZ", nullable: false };
      return { type: "VARCHAR", nullable: false };
    case "integer":
      return { type: "BIGINT", nullable: false };
    case "number":
      return { type: "DOUBLE", nullable: false };
    case "boolean":
      return { type: "BOOLEAN", nullable: false };
    case "array":
      return { type: `${s.items ? sqlType(s.items).type : "JSON"}[]`, nullable: false };
    default:
      return { type: "JSON", nullable: false };
  }
}

/** Column name → DuckDB type, in schema order. */
export function columns(table: TableName): [string, string][] {
  const js = z.toJSONSchema(TABLES[table].schema, { io: "input" }) as { properties: Record<string, JsonSchema> };
  return Object.entries(js.properties).map(([name, s]) => {
    const { type, nullable } = sqlType(s);
    return [name, nullable || name === "id" ? type : `${type} NOT NULL`];
  });
}

const literal = (v: unknown, type: string): string =>
  v === null
    ? "NULL"
    : Array.isArray(v)
      ? `[${v.map((x) => literal(x, type.replace(/\[\]$/, ""))).join(", ")}]::${type}`
      : typeof v === "string"
        ? `'${v.replaceAll("'", "''")}'`
        : typeof v === "object"
          ? `'${JSON.stringify(v).replaceAll("'", "''")}'::JSON`
          : String(v);

/**
 * The SELECT list that reads a table's shards: a column with a default reads as that default where a shard has no
 * value, so a shard written before an additive column existed still loads.
 */
export function selectList(table: TableName): string {
  const js = z.toJSONSchema(TABLES[table].schema, { io: "input" }) as { properties: Record<string, JsonSchema> };
  return columns(table)
    .map(([n, t]) => {
      const d = js.properties[n]?.default;
      return d === undefined ? `"${n}"` : `COALESCE("${n}", ${literal(d, t.replace(" NOT NULL", ""))}) AS "${n}"`;
    })
    .join(", ");
}

export function ddl(table: TableName): string {
  const cols = columns(table).map(([n, t]) => `  "${n}" ${t}${n === "id" ? " PRIMARY KEY" : ""}`);
  return `CREATE TABLE IF NOT EXISTS ${table} (\n${cols.join(",\n")}\n);`;
}
