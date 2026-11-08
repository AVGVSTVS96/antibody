import type { z } from "zod";

export function parseJson<T>(text: string, schema: z.ZodType<T>): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(text)?.[1];
  const body = (fenced ?? text).trim();
  const start = body.search(/[[{]/u);
  let depth = 0;
  let quoted = false;
  let end = body.length;

  for (let i = start; i < body.length; i++) {
    const c = body[i];

    if (quoted) {
      if (c === "\\") {
        i++;
      } else if (c === '"') {
        quoted = false;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === "[" || c === "{") {
      depth++;
    } else if ((c === "]" || c === "}") && --depth === 0) {
      end = i + 1;
      break;
    }
  }

  const json = body.slice(start, end);

  try {
    return schema.parse(JSON.parse(json));
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }

    return schema.parse(JSON.parse(json.replaceAll(/,(\s*[\]}])/gu, "$1")));
  }
}
