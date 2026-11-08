import { must } from "@antibody/core";
import { headingScore } from "./headings.ts";
import type { ParsedSheet, Scope } from "./parsed.ts";

interface Paragraph {
  heading: string;
  text: string;
  page: number;
}

const TITLE_OF_DIVISION = /\bTitle (?<title>[IVXLC]+) of division (?<division>[A-Z]{1,2})\b/iu;
const DIVISION = /\bDivision (?<division>[A-Z]{1,2}) of (?:the bill|H\.R\.|S\.)/u;
const SMALL = new Set("a an and for in of on or the to with".split(" "));

function isHeading(line: string): boolean {
  const words = line.split(/\s+/u);

  return (
    line.length <= 90 &&
    !/[.:;,]$/u.test(line) &&
    words.every((w) => SMALL.has(w) || /^[A-Z0-9(]/u.test(w)) &&
    /^[A-Z]/u.test(line)
  );
}

function runIn(line: string): [string, string] | null {
  const m = /^(?<heading>[A-Z][A-Za-z,&' -]{8,70})\. (?=[A-Z])/u.exec(line);
  const heading = m?.groups?.heading;

  return m &&
    heading !== undefined &&
    heading.split(/\s+/u).length >= 2 &&
    heading.split(/\s+/u).every((w) => SMALL.has(w) || /^[A-Z]/u.test(w))
    ? [heading, line.slice(m[0].length)]
    : null;
}

const FURNITURE = /^(?:Page \d+|Honorable .+|Congressional Budget Office.*)$/u;
const TABLE_PAGE = /^Table \d+\./mu;

export function paragraphs(pages: string[]): Paragraph[] {
  const out: Paragraph[] = [];
  let ended = true;

  for (const [p, page] of pages.entries()) {
    if (TABLE_PAGE.test(page)) {
      continue;
    }

    for (const raw of page.split("\n")) {
      const line = raw.trim();

      if (!line || FURNITURE.test(line)) {
        continue;
      }

      const run = ended ? runIn(line) : null;

      if (run) {
        out.push({ heading: run[0], text: run[1], page: p + 1 });
      } else if (ended && isHeading(line)) {
        out.push({ heading: line, text: "", page: p + 1 });
      } else {
        const last = out.at(-1);

        if (last) {
          last.text += ` ${line}`;
        }
      }

      ended = /[.:;!?)]\s*\d{0,2}$/u.test(line) || isHeading(line);
    }
  }

  return out;
}

export function scopeFromText(labels: string[], pages: string[]): Scope | undefined {
  const all = paragraphs(pages);

  for (const label of labels) {
    const [best, next] = all
      .map((p) => ({ p, ...headingScore(label, p.heading) }))
      .filter((x) => x.confident)
      .toSorted((a, b) => b.shared - a.shared);

    const found = best && best.shared !== next?.shared ? scopeIn(best.p) : undefined;

    if (found) {
      return found;
    }
  }

  return undefined;
}

function scopeIn(p: Paragraph): Scope | undefined {
  const text = `${p.heading}. ${p.text}`.replaceAll(/\s+/gu, " ");
  const titleHit = TITLE_OF_DIVISION.exec(text);
  const divisionHit = DIVISION.exec(text);
  const hit = [titleHit, divisionHit].filter((m) => m !== null).toSorted((a, b) => a.index - b.index)[0];

  if (!hit) {
    return undefined;
  }

  const division = must(hit.groups?.division, "a division letter");

  const start = text.lastIndexOf(". ", hit.index) + 2;
  const end = text.indexOf(". ", hit.index);
  const quote = text.slice(Math.max(0, start), end === -1 ? undefined : end + 1).trim();

  return hit === titleHit
    ? {
        division: division.toUpperCase(),
        title: must(hit.groups?.title, "a title numeral").toUpperCase(),
        quote,
        page: p.page,
      }
    : { division, title: null, quote, page: p.page };
}

export function scopeRows(sheets: ParsedSheet[], pages: string[]): void {
  const seen = new Map<string, Scope | undefined>();

  for (const row of sheets.flatMap((s) => s.rows)) {
    const label = row.section_title;

    if (
      row.line_kind === "program" &&
      (row.division ?? "") === "" &&
      (row.title_no ?? "") === "" &&
      label !== null &&
      label !== ""
    ) {
      const key = `${row.parent ?? ""}|${label}`;

      if (!seen.has(key)) {
        seen.set(key, scopeFromText([label, ...[row.parent ?? ""].filter((p) => p !== "")], pages));
      }

      const scope = seen.get(key);

      if (scope) {
        row.scope = scope;
      }
    }
  }
}
