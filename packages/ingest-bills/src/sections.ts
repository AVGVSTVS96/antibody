import type { ChildNode } from "domhandler";
import { canon, citations, norm, normEnum, shingles, words } from "./text.ts";
import { child, descendant, type Element, isElement, kids, local, parseXml, textOf } from "./xml.ts";

/** One section of one text version. */
export interface Sec {
  /** `title:VII/subtitle:A/chapter:1/sec:70114` */
  path: string;
  heading: string;
  text: string;
  xmlId: string | null;
  hash: string;
  words: number;
  sh: Set<string>;
  cites: Set<string>;
}

const CONTAINERS = new Set(["division", "title", "subtitle", "part", "subpart", "chapter", "subchapter"]);
const TEXT_SKIP = new Set(["toc", "page", "sidenote", "footnote", "endnote", "note", "notes"]);
/** Quoted blocks hold the text a section inserts into other law; their inner sections aren't the bill's own. */
const SKIP = new Set([...TEXT_SKIP, "quoted-block", "quotedContent"]);
const LABELS = new Set(["enum", "num", "header", "heading"]);

const deleted = (e: Element) => e.attribs.changed === "deleted";

function sectionText(section: Element): string {
  const out: string[] = [];
  const rec = (n: ChildNode) => {
    if (n.type === "text") out.push(n.data);
    else if (isElement(n)) {
      const name = local(n);
      if (name === "num" || name === "enum") out.push(normEnum(textOf(n)));
      else if (!deleted(n) && !TEXT_SKIP.has(name)) n.children.forEach(rec);
    }
  };
  for (const n of section.children) if (!(isElement(n) && LABELS.has(local(n)))) rec(n);
  return norm(out.join(" "));
}

export class PartialAmendment extends Error {}

/** Where a version's own provisions live: the bill body, the law's main, or a full-substitute amendment's block. */
function body(root: Element): Element {
  const name = local(root);
  if (name === "amendment-doc") {
    const block = descendant(root, "amendment-block");
    const instruction = norm(textOf(descendant(root, "amendment-instruction") ?? root)).toLowerCase();
    if (!block || !/strike (out )?all after/.test(instruction))
      throw new PartialAmendment("amendment is not a full substitute; page-and-line amendments aren't split yet");
    return block;
  }
  if (name === "bill" || name === "resolution") {
    const b = child(root, "legis-body") ?? child(root, "resolution-body") ?? child(root, "main");
    if (!b) throw new Error(`${name} has no body`);
    return b;
  }
  return child(root, "main") ?? root;
}

const label = (e: Element) => child(e, "enum") ?? child(e, "num");

export function hashSection(heading: string, text: string): string {
  return new Bun.CryptoHasher("sha1")
    .update(`${canon(heading)}\n${canon(text)}`)
    .digest("hex")
    .slice(0, 16);
}

export function parseSections(xml: string): Sec[] {
  const out: Sec[] = [];
  const walk = (e: Element, trail: string[]) => {
    for (const c of kids(e)) {
      const name = local(c);
      if (SKIP.has(name) || deleted(c)) continue;
      const enumEl = label(c);
      const num = enumEl ? normEnum(textOf(enumEl)) : "?";
      if (CONTAINERS.has(name)) walk(c, [...trail, `${name}:${num}`]);
      else if (name === "section") {
        const head = child(c, "header") ?? child(c, "heading");
        const heading = head ? norm(textOf(head)) : "";
        const text = sectionText(c);
        out.push({
          path: [...trail, `sec:${num}`].join("/"),
          heading,
          text,
          xmlId: c.attribs.id ?? null,
          hash: hashSection(heading, text),
          words: words(text),
          sh: shingles(text),
          cites: citations(text),
        });
      } else walk(c, trail);
    }
  };
  walk(body(parseXml(xml)), []);
  return out;
}

/** `sec:70114` → `70114` */
export function sectionNum(path: string): string {
  return path.slice(path.lastIndexOf("sec:") + 4);
}
