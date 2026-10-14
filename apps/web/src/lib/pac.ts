import { nice } from "./format.ts";

const TRAILING_PARENS = /\(\s*(?:A\.?K\.?A\.?\s+)?['"]?([^()]*?)['"]?\s*(\))?\s*$/i;

/**
 * A PAC the way the FEC record itself shortens it, when the record gives a name in trailing parentheses
 * ("TEXAS INSTRUMENTS INCORPORATED POLITICAL ACTION COMMITTEE (TI PAC)" is "TI PAC"); else the full name. Never cut.
 * A one-word short name is a coined acronym ("CATPAC") and stays as filed. The FEC's name field is itself cut at a
 * fixed length, so a parenthesis it never closed counts as a short name only when it ends like one ("... PAC").
 */
export function pacName(label: string): string {
  const tidy = label.replace(/\s+/g, " ").trim();
  const open = TRAILING_PARENS.exec(tidy);
  const short = open?.[1]?.trim();
  if (!open || !short || /^(USA|U\.S\.)$/i.test(short)) return nice(tidy);
  if (!open[2] && !/\b(PAC|FUND)$/i.test(short)) return nice(tidy.slice(0, open.index).trim());
  if (short.length < 3) return nice(tidy.replace(/\s*\([^()]*\)?$/, ""));
  const named = short.replace(/\bPOLITICAL ACTION COMMITTEE\b/i, "PAC");
  return /\s/.test(named) ? nice(named) : named;
}
