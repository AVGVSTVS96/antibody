import type { BillId, Row } from "@antibody/core";
import { PARTS, type SectionPart } from "@antibody/ingest-bills";

export const PARTS_VERSION = PARTS.version;

/** `title:VII, sec. 4, subsection (a), paragraph (12)`: where a part sits in the final text. */
export const partLocator = (sectionPath: string, partPath: string) =>
  [
    ...sectionPath.split("/").map((p) => p.replace(":", " ").replace(/^sec /, "sec. ")),
    ...(partPath ? partPath.split("/").map((p) => p.replace(/:(.*)$/, " ($1)")) : ["opening words"]),
  ].join(", ");

export function partRows(bill: BillId, sections: Row<"sections">[], parts: SectionPart[]): Row<"section_parts">[] {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const ords = new Map<string, number>();
  return parts.map((p) => {
    const ord = ords.get(p.sectionId) ?? 0;
    ords.set(p.sectionId, ord + 1);
    const s = byId.get(p.sectionId)!;
    const finalPath = (s.history[p.version] as { path: string } | undefined)?.path ?? s.path;
    return {
      id: p.id,
      bill_id: bill,
      section_id: p.sectionId,
      num: p.num,
      ord,
      enum: p.enum,
      heading: p.heading,
      trail: p.trail,
      path: p.path,
      lead_in: p.leadIn,
      words: p.words,
      preview: p.text.slice(0, 200),
      first_version: p.firstVersion,
      late: p.late,
      version: p.version,
      source_url: p.url,
      source_locator: `${partLocator(finalPath, p.path)}${p.leadIn && p.path ? ", its own words outside its subdivisions" : ""}`,
    };
  });
}

/** How a part reads where a section is expected (the matcher's menu, the quiet check): its section named alongside. */
export function asSection(p: Row<"section_parts">, s: Row<"sections">): Row<"sections"> {
  const what = p.heading || (p.lead_in ? "opening words" : (p.trail.at(-1) ?? ""));
  return {
    ...s,
    id: p.id,
    num: p.num,
    heading: `${what}${what ? " " : ""}(part of sec. ${s.num}${s.heading ? `, ${s.heading}` : ""})`,
    path: `${s.path}/${p.path}`,
    preview: p.preview,
    words: p.words,
    late: p.late,
    first_version: p.first_version,
  };
}

/** Parts of long sections, dropped ones included (the menu marks them), each read as a section row, in text order. */
export function partSections(sections: Row<"sections">[], parts: Row<"section_parts">[]): Row<"sections">[] {
  const byId = new Map(sections.map((s) => [s.id, s]));
  return parts
    .toSorted((a, b) => a.section_id.localeCompare(b.section_id) || a.ord - b.ord)
    .flatMap((p) => {
      const s = byId.get(p.section_id);
      return s ? [asSection(p, s)] : [];
    });
}
