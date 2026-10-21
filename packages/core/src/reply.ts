/**
 * The first JSON value in a model reply. The model sometimes wraps it in a code fence, adds a sentence or a second
 * answer after it, or leaves a trailing comma before a closing bracket (matching a long bill's articles failed on
 * every retry that way).
 */
export function parseJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1]! : text).trim();
  const start = body.search(/[[{]/);
  let depth = 0;
  let quoted = false;
  let end = body.length;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === "\\") i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "[" || c === "{") depth++;
    else if ((c === "]" || c === "}") && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  const json = body.slice(start, end);
  try {
    return JSON.parse(json) as T;
  } catch {
    return JSON.parse(json.replace(/,(\s*[\]}])/g, "$1")) as T;
  }
}
