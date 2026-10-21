import type { Row } from "@antibody/core";
import { cached } from "./fetch.ts";
import { parseSections, type Sec } from "./sections.ts";
import { versionFile } from "./versions.ts";

export interface SectionText {
  text: string;
  /** The version the text is from: the final one, or the last one a removed section was in. */
  version: string;
  url: string;
  path: string;
}

/**
 * Each section's full text as last seen, read again from the version XML the bills stage downloaded (the sections
 * rows keep only a preview). A section is found in its last version by the hash its history recorded, else its path.
 */
export async function sectionTexts(
  sections: Row<"sections">[],
  versions: Row<"versions">[],
): Promise<Map<string, SectionText>> {
  const urlOf = new Map(versions.map((v) => [v.code, v.url]));
  const lastOf = (s: Row<"sections">) => Object.keys(s.history).at(-1)!;
  const out = new Map<string, SectionText>();
  for (const code of new Set(sections.map(lastOf))) {
    const url = urlOf.get(code);
    if (!url) continue;
    const secs = parseSections(await cached(url, versionFile(url)));
    const byHash = new Map<string, Sec>();
    const byPath = new Map<string, Sec>();
    for (const sec of secs) {
      if (!byHash.has(sec.hash)) byHash.set(sec.hash, sec);
      if (!byPath.has(sec.path)) byPath.set(sec.path, sec);
    }
    for (const s of sections.filter((x) => lastOf(x) === code)) {
      const step = s.history[code] as { path: string; hash: string };
      const sec = byHash.get(step.hash) ?? byPath.get(step.path);
      if (sec) out.set(s.id, { text: sec.text, version: code, url, path: step.path });
    }
  }
  return out;
}
