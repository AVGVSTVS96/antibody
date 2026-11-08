import { z } from "zod";
import { isRecord, isText, JsonValue } from "./json.ts";
import type { Json } from "./json.ts";
import { TABLES } from "./tables.ts";
import type { TableName } from "./tables.ts";

type JsonSchema = z.core.JSONSchema._JSONSchema;

interface SqlType {
  type: string;
  nullable: boolean;
}

function sqlType(s: JsonSchema): SqlType {
  if (s === true || s === false) {
    return { type: "JSON", nullable: false };
  }

  if (Array.isArray(s.type)) {
    const types = s.type.filter((t) => t !== "null");
    const [only] = types;
    const one = types.length === 1 && only !== undefined ? sqlType({ ...s, type: only }) : { type: "JSON" };

    return { type: one.type, nullable: types.length < s.type.length };
  }

  if (s.anyOf) {
    const nonNull = s.anyOf.filter((x) => x.type !== "null");
    const [only] = nonNull;

    if (nonNull.length !== 1 || only === undefined) {
      return { type: "JSON", nullable: true };
    }

    return { type: sqlType(only).type, nullable: nonNull.length < s.anyOf.length };
  }

  const element = s.items === undefined || Array.isArray(s.items) ? "JSON" : sqlType(s.items).type;

  const type =
    s.type === "string"
      ? s.format === "date"
        ? "DATE"
        : s.format === "date-time"
          ? "TIMESTAMPTZ"
          : "VARCHAR"
      : s.type === "integer"
        ? "BIGINT"
        : s.type === "number"
          ? "DOUBLE"
          : s.type === "boolean"
            ? "BOOLEAN"
            : s.type === "array"
              ? `${element}[]`
              : "JSON";

  return { type, nullable: false };
}

const properties = (table: TableName) => z.toJSONSchema(TABLES[table].schema, { io: "input" }).properties ?? {};

export function columns(table: TableName): [string, string][] {
  return Object.entries(properties(table)).map(([name, s]) => {
    const { type, nullable } = sqlType(s);

    return [name, nullable || name === "id" ? type : `${type} NOT NULL`];
  });
}

const literal = (v: Json, type: string): string =>
  v === null
    ? "NULL"
    : Array.isArray(v)
      ? `[${v.map((x) => literal(x, type.replace(/\[\]$/u, ""))).join(", ")}]::${type}`
      : isText(v)
        ? `'${v.replaceAll("'", "''")}'`
        : isRecord(v)
          ? `'${JSON.stringify(v).replaceAll("'", "''")}'::JSON`
          : String(v);

export function selectList(table: TableName): string {
  const props = properties(table);

  return columns(table)
    .map(([n, t]) => {
      const prop = props[n];
      const d = prop === undefined || prop === true || prop === false ? undefined : prop.default;

      return d === undefined
        ? `"${n}"`
        : `COALESCE("${n}", ${literal(JsonValue.parse(d), t.replace(" NOT NULL", ""))}) AS "${n}"`;
    })
    .join(", ");
}

export function ddl(table: TableName): string {
  const cols = columns(table).map(([n, t]) => `  "${n}" ${t}${n === "id" ? " PRIMARY KEY" : ""}`);

  return `CREATE TABLE IF NOT EXISTS ${table} (\n${cols.join(",\n")}\n);`;
}
