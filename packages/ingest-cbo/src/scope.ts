import { headingScore } from "./headings.ts";
import type { ParsedSheet, Scope } from "./parsed.ts";

interface Paragraph {
  heading: string;
  text: string;
  page: number;
}

const TITLE_OF_DIVISION = /\bTitle ([IVXLC]+) of division ([A-Z]{1,2})\b/i;
const DIVISION = /\bDivision ([A-Z]{1,2}) of (?:the bill|H\.R\.|S\.)/;
const SMALL = new Set("a an and for in of on or the to with".split(" "));

/** A line that is a heading rather than a sentence: short, in title case, without closing punctuation. */
function isHeading(line: string): boolean {
  const words = line.split(/\s+/);
  return (
    line.length <= 90 &&
    !/[.:;,]$/.test(line) &&
    words.every((w) => SMALL.has(w) || /^[A-Z0-9(]/.test(w)) &&
    /^[A-Z]/.test(line)
  );
}

/** A run-in heading: "Supplemental Nutrition Assistance Program. To receive …". */
function runIn(line: string): [string, string] | null {
  const m = line.match(/^([A-Z][A-Za-z,&' -]{8,70})\. (?=[A-Z])/);
  return m && m[1]!.split(/\s+/).length >= 2 && m[1]!.split(/\s+/).every((w) => SMALL.has(w) || /^[A-Z]/.test(w))
    ? [m[1]!, line.slice(m[0].length)]
    : null;
}

const FURNITURE = /^(?:Page \d+|Honorable .+|Congressional Budget Office.*)$/;
const TABLE_PAGE = /^Table \d+\./m;

/**
 * The paragraphs of a CBO letter, each under the heading (or run-in heading) that opens it. A heading comes after a
 * line that ends a sentence, so a bullet wrapped over two lines isn't taken for one; pages of tables are left out.
 */
export function paragraphs(pages: string[]): Paragraph[] {
  const out: Paragraph[] = [];
  let ended = true;
  for (const [p, page] of pages.entries()) {
    if (TABLE_PAGE.test(page)) continue;
    for (const raw of page.split("\n")) {
      const line = raw.trim();
      if (!line || FURNITURE.test(line)) continue;
      const run = ended ? runIn(line) : null;
      if (run) out.push({ heading: run[0], text: run[1], page: p + 1 });
      else if (ended && isHeading(line)) out.push({ heading: line, text: "", page: p + 1 });
      else if (out.length) out.at(-1)!.text += ` ${line}`;
      ended = /[.:;!?)]\s*\d{0,2}$/.test(line) || isHeading(line);
    }
  }
  return out;
}

/**
 * The division and title CBO's text says a provision sits in: the paragraph under the heading that names the row's
 * label, and the first "Title II of division B" or "Division C of the bill" in it. A row that sits under a parent
 * heading ("Work Requirements" over a program) falls back to what the parent's paragraph says. Nothing is returned
 * unless one paragraph fits the label clearly.
 */
export function scopeFromText(labels: string[], pages: string[]): Scope | undefined {
  const all = paragraphs(pages);
  for (const label of labels) {
    const [best, next] = all
      .map((p) => ({ p, ...headingScore(label, p.heading) }))
      .filter((x) => x.confident)
      .sort((a, b) => b.shared - a.shared);
    const found = best && best.shared !== next?.shared ? scopeIn(best.p) : undefined;
    if (found) return found;
  }
  return undefined;
}

function scopeIn(p: Paragraph): Scope | undefined {
  const text = `${p.heading}. ${p.text}`.replace(/\s+/g, " ");
  const title = TITLE_OF_DIVISION.exec(text);
  const division = DIVISION.exec(text);
  const hit = [title, division].filter((m): m is RegExpExecArray => !!m).sort((a, b) => a.index - b.index)[0];
  if (!hit) return undefined;
  const start = text.lastIndexOf(". ", hit.index) + 2;
  const end = text.indexOf(". ", hit.index);
  const quote = text.slice(Math.max(0, start), end < 0 ? undefined : end + 1).trim();
  return hit === title
    ? { division: hit[2]!.toUpperCase(), title: hit[1]!.toUpperCase(), quote, page: p.page }
    : { division: hit[1]!, title: null, quote, page: p.page };
}

/** Gives every provision row whose table names no division or title the scope CBO's text states for it, if any. */
export function scopeRows(sheets: ParsedSheet[], pages: string[]): void {
  const seen = new Map<string, Scope | undefined>();
  for (const row of sheets.flatMap((s) => s.rows))
    if (row.line_kind === "program" && !row.division && !row.title_no && row.section_title) {
      const key = `${row.parent ?? ""}|${row.section_title}`;
      if (!seen.has(key)) seen.set(key, scopeFromText([row.section_title, ...(row.parent ? [row.parent] : [])], pages));
      const scope = seen.get(key);
      if (scope) row.scope = scope;
    }
}
