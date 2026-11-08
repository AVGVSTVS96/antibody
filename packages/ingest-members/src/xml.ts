import { XMLParser } from "fast-xml-parser";

export type Xml = string | Xml[] | XmlElement;

export interface XmlElement {
  readonly [tag: string]: Xml | undefined;
}

const LISTS = new Set(["item", "recordedVote", "amendment", "action"]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  isArray: (name) => LISTS.has(name),
});

function isXml(value: unknown): value is Xml {
  return typeof value === "string" || (Array.isArray(value) ? value.every(isXml) : isTree(value));
}

function isTree(value: unknown): value is XmlElement {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every(isXml);
}

export const isText = (node: Xml | undefined): node is string => typeof node === "string";

export const isElement = (node: Xml | undefined): node is XmlElement =>
  node !== undefined && !isText(node) && !Array.isArray(node);

export function parseXml(text: string): XmlElement {
  const doc: unknown = parser.parse(text);

  if (!isTree(doc)) {
    throw new TypeError("XML did not parse into elements");
  }

  return doc;
}

export function element(node: XmlElement, tag: string): XmlElement {
  const child = node[tag];

  if (!isElement(child)) {
    throw new Error(`missing <${tag}>`);
  }

  return child;
}

export function textOf(node: Xml | undefined): string {
  if (isText(node)) {
    return node;
  }

  return isElement(node) && isText(node["#text"]) ? node["#text"] : "";
}

export const text = (node: XmlElement, tag: string): string => textOf(node[tag]);

export function all(node: XmlElement, tag: string): XmlElement[] {
  return [node[tag] ?? []].flat().filter(isElement);
}
