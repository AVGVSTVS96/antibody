import type { ChildNode, Element } from "domhandler";
import { ElementType, parseDocument } from "htmlparser2";

export type { Element } from "domhandler";

export function parseXml(xml: string): Element {
  const doc = parseDocument(xml, { xmlMode: true });
  const root = doc.children.find(isElement);

  if (!root) {
    throw new Error("no root element");
  }

  return root;
}

export function isElement(n: ChildNode): n is Element {
  return n.type === ElementType.Tag;
}

export function local(e: Element): string {
  const i = e.name.indexOf(":");

  return i === -1 ? e.name : e.name.slice(i + 1);
}

export function kids(e: Element): Element[] {
  return e.children.filter(isElement);
}

export function child(e: Element, name: string): Element | undefined {
  return kids(e).find((c) => local(c) === name);
}

export function children(e: Element, name: string): Element[] {
  return kids(e).filter((c) => local(c) === name);
}

export function all(e: Element, path: string): Element[] {
  let level = [e];

  for (const step of path.split("/")) {
    level = level.flatMap((x) => children(x, step));
  }

  return level;
}

export function first(e: Element, path: string): Element | undefined {
  return all(e, path)[0];
}

export function descendant(e: Element, name: string): Element | undefined {
  for (const c of kids(e)) {
    if (local(c) === name) {
      return c;
    }

    const d = descendant(c, name);

    if (d) {
      return d;
    }
  }

  return undefined;
}

export function textOf(n: ChildNode): string {
  if (n.type === ElementType.Text) {
    return n.data;
  }

  if (isElement(n)) {
    return n.children.map(textOf).join("");
  }

  return "";
}

export function at(e: Element, path: string): string | null {
  const hit = first(e, path);
  const s = hit ? textOf(hit).trim() : "";

  return s || null;
}
