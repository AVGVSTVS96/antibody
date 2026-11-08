export const isObject = (v: unknown): v is object => typeof v === "object" && v !== null && !Array.isArray(v);

export const isText = (v: unknown): v is string => typeof v === "string";

export const isNumber = (v: unknown): v is number => typeof v === "number";

export const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";

export const isTextOrNull = (v: unknown): v is string | null => v === null || isText(v);
