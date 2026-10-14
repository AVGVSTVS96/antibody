import { type BillId, ordinal, type Row } from "@antibody/core";
import type { AmendmentRecord } from "./billstatus.ts";
import { type AmendmentText, senateAmendmentText, textPages } from "./crec.ts";
import type { Lineage } from "./lineage.ts";
import { canon, headingWords, intersect, shingles } from "./text.ts";

type Status = Row<"amendments">["status"];

export function amendmentId(a: AmendmentRecord): string {
  return `${a.congress}-${a.type.toLowerCase()}-${a.number}`;
}

const LABEL: Record<string, [string, string]> = {
  SAMDT: ["S.Amdt.", "senate-amendment"],
  HAMDT: ["H.Amdt.", "house-amendment"],
  SUAMDT: ["S.Up.Amdt.", "senate-amendment"],
};

export function amendmentLabel(a: AmendmentRecord): string {
  return `${LABEL[a.type]?.[0] ?? `${a.type} `}${a.number}`;
}

export function amendmentUrl(a: AmendmentRecord): string {
  return `https://www.congress.gov/amendment/${a.congress}${ordinal(a.congress)}-congress/${LABEL[a.type]?.[1] ?? "amendment"}/${a.number}`;
}

/** Read from the latest action's own words, so a tabled or ruled-out amendment never reads as agreed. */
export function amendmentStatus(a: AmendmentRecord): Status {
  const t = a.latestAction?.text ?? "";
  if (!t && !a.actions.some((x) => x.text && !/submitted/i.test(x.text))) return "no_action";
  if (/withdrawn/i.test(t)) return "withdrawn";
  if (
    /not agreed|failed|ruled out of order|\bfell\b|not having achieved|motion to table[^.]*agreed|point of order[^.]*sustained/i.test(
      t,
    )
  )
    return "failed";
  if (/\bagreed to\b|adopted/i.test(t)) return "agreed";
  return t ? "other" : "no_action";
}

/** `senate-119-1-370`, the id ingest-members gives roll calls. */
export function rollId(a: AmendmentRecord): string | null {
  const action =
    a.actions.find((x) => x.text === a.latestAction?.text && x.votes.length) ?? a.actions.find((x) => x.votes.length);
  const v = action?.votes[0];
  return v ? `${v.chamber.toLowerCase()}-${v.congress}-${v.session}-${v.roll}` : null;
}

export function lastActionDate(a: AmendmentRecord): string | null {
  const dates = a.actions.map((x) => x.date).filter(Boolean);
  return dates.length ? dates.sort().at(-1)! : a.submittedOn;
}

/** The version step (`pcs->eas`) whose dates bracket the amendment's last action. */
export function versionStep(when: string | null, versions: { code: string; date: string | null }[]): string | null {
  if (!when) return null;
  for (let i = 1; i < versions.length; i++) {
    const [a, b] = [versions[i - 1]!, versions[i]!];
    const end = versions.slice(i).find((v) => v.date)?.date;
    if (a.date && a.date <= when && (!end || when <= end)) return `${a.code}->${b.code}`;
  }
  return null;
}

const isSubstitute = (a: AmendmentRecord, text: AmendmentText | null) =>
  /nature of a substitute/i.test(a.purpose ?? "") || /strike (out )?all after/i.test(text?.text.slice(0, 2000) ?? "");

/** A section of a substitute as printed in the Record: its heading from the table of contents, and its text. */
function sectionIn(text: string, num: string): { heading: string | null; body: string } {
  const toc = text.match(new RegExp(`Sec\\. ${num}\\. ([\\s\\S]{3,300}?)\\.\\s*\\n`));
  const start = text.search(new RegExp(`\\n\\s*SEC\\. ${num}\\. `));
  const rest = start < 0 ? "" : text.slice(start + 1);
  const end = rest.slice(10).search(/\n\s*SEC\. \d+[A-Z]?\. /);
  return { heading: toc ? toc[1]!.replace(/\s+/g, " ") : null, body: end < 0 ? rest : rest.slice(0, end + 10) };
}

interface StepInput {
  bill: BillId;
  from: string;
  to: string;
  agreed: { rec: AmendmentRecord; text: AmendmentText | null; when: string | null }[];
  /** Lineages first seen in `to` that aren't pure splits. */
  added: Lineage[];
  /** Lineages present in `from` that end at `to`. */
  removed: Lineage[];
  /** Text of amended amendments (a strike names a section number of the substitute it amends). */
  amended: Map<string, AmendmentText | null>;
}

const SHARE = 0.6;

/**
 * Who offered each section a step added or struck. A section whose wording sits in an agreed amendment's printed text
 * is that amendment's (the smallest such amendment, so a second-degree amendment wins over the substitute it amends).
 * Otherwise, when one amendment was agreed in that step, or one full substitute, it's that one, labeled inferred.
 */
export function attribute(s: StepInput): Row<"amendment_sections">[] {
  const rows: Row<"amendment_sections">[] = [];
  const texts = s.agreed
    .filter((a) => a.text)
    .map((a) => ({ ...a, sh: shingles(a.text!.text), canon: canon(a.text!.text) }))
    .sort((x, y) => x.canon.length - y.canon.length);
  const subs = s.agreed
    .filter((a) => isSubstitute(a.rec, a.text))
    .sort((x, y) => (x.when ?? "").localeCompare(y.when ?? ""));
  const stepLabel = `${s.from}->${s.to}`;
  const row = (
    a: AmendmentRecord,
    l: Lineage,
    how: "text" | "inferred",
    effect: "inserted" | "struck",
    rule: string,
    confidence: number,
    evidence: Record<string, unknown>,
  ): Row<"amendment_sections"> => ({
    id: `${amendmentId(a)}>${l.id}`,
    amendment_id: amendmentId(a),
    section_id: l.id,
    how,
    effect,
    rule,
    confidence,
    rests_on: [`amendments/${amendmentId(a)}`, `sections/${l.id}`],
    evidence: { step: stepLabel, ...evidence },
  });

  for (const l of s.added) {
    const sec = l.history[s.to]!;
    const own = shingles(l.last.text);
    const holders = texts.filter((t) =>
      own.size >= 5
        ? intersect(own, t.sh) / own.size >= SHARE
        : t.canon.includes(canon(`${sec.heading} ${l.last.text}`)),
    );
    const [best, ...others] = holders;
    if (best) {
      rows.push(
        row(
          best.rec,
          l,
          "text",
          "inserted",
          "amendment-text: the section's wording is in the amendment's printed text",
          0.9,
          {
            sourceUrl: best.text!.url,
            citation: best.text!.citation,
            share: own.size ? Math.round((intersect(own, best.sh) / own.size) * 1000) / 1000 : null,
            alsoIn: others.map((o) => amendmentId(o.rec)),
          },
        ),
      );
      continue;
    }
    const only = s.agreed.length === 1 ? s.agreed[0]! : null;
    const sub = subs.at(-1);
    if (only)
      rows.push(
        row(
          only.rec,
          l,
          "inferred",
          "inserted",
          "only-agreed-amendment: the one amendment agreed to between the two versions",
          isSubstitute(only.rec, only.text) ? 0.8 : 0.6,
          {
            agreedInStep: [amendmentId(only.rec)],
          },
        ),
      );
    else if (sub)
      rows.push(
        row(
          sub.rec,
          l,
          "inferred",
          "inserted",
          "last-agreed-substitute: the last full substitute agreed to between the two versions",
          0.5,
          {
            agreedInStep: s.agreed.map((a) => amendmentId(a.rec)),
          },
        ),
      );
  }

  for (const a of texts) {
    const strike = a.text!.text.match(/\bStrike section (\d+[A-Za-z]*)\.\s*(?:_{3,}|$)/);
    const parent = a.rec.amends ? s.amended.get(a.rec.amends) : null;
    if (!strike || !parent) continue;
    const struck = sectionIn(parent.text, strike[1]!);
    const words = headingWords(struck.heading ?? "");
    const sh = shingles(struck.body);
    const scored = s.removed
      .map((l) => {
        const hw = headingWords(l.history[s.from]!.heading);
        const shared = intersect(words, hw);
        const small = Math.min(sh.size, l.last.sh.size);
        return {
          l,
          heading: shared / Math.max(1, words.size + hw.size - shared),
          wording: small ? intersect(sh, l.last.sh) / small : 0,
        };
      })
      .sort((x, y) => Math.max(y.heading, y.wording) - Math.max(x.heading, x.wording));
    const top = scored[0];
    if (top && (top.heading >= 0.5 || top.wording >= 0.3))
      rows.push(
        row(
          a.rec,
          top.l,
          "text",
          "struck",
          "amendment-strike: the amendment strikes the substitute's section that carries this section's heading or wording",
          0.8,
          {
            sourceUrl: a.text!.url,
            citation: a.text!.citation,
            struck: `section ${strike[1]} of ${a.rec.amends}`,
            headingInSubstitute: struck.heading,
            substituteUrl: parent.url,
            headingScore: Math.round(top.heading * 1000) / 1000,
            wordingScore: Math.round(top.wording * 1000) / 1000,
          },
        ),
      );
  }
  return rows;
}

/** Fetches the printed text of each agreed Senate amendment (House amendment text isn't split into granules). */
export async function loadText(a: AmendmentRecord): Promise<AmendmentText | null> {
  if (a.chamber !== "Senate") return null;
  const dates = [a.submittedOn, ...a.actions.map((x) => x.date)].filter((d): d is string => !!d);
  return senateAmendmentText(a.number, dates, textPages(a.actions));
}
