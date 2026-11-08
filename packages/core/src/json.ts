import { z } from "zod";

export const JsonValue = z.json();

export type Json = z.infer<typeof JsonValue>;

export type Tree = string | number | boolean | null | undefined | Tree[] | { [key: string]: Tree };

export const isText = (v: Tree): v is string => typeof v === "string";

export const isRecord = (v: Tree): v is { [key: string]: Tree } =>
  typeof v === "object" && v !== null && !Array.isArray(v);
