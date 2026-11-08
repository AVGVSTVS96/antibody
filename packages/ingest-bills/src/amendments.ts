import { ordinal, must } from "@antibody/core";
import type { BillId, Row } from "@antibody/core";
import type { AmendmentRecord } from "./billstatus.ts";
import { senateAmendmentText, textPages } from "./crec.ts";
import type { AmendmentText } from "./crec.ts";
import type { Lineage } from "./lineage.ts";
import { canon, headingWords, intersect, shingles } from "./text.ts";

type Status = Row<"amendments">["status"];

export function amendmentId(a: AmendmentRecord): string {
  return `${a.congress}-${a.type.toLowerCase()}-${a.number}`;
}

const LABEL = new Map([
  ["SAMDT", { short: "S.Amdt.", path: "senate-amendment" }],
  ["HAMDT", { short: "H.Amdt.", path: "house-amendment" }],
  ["SUAMDT", { short: "S.Up.Amdt.", path: "senate-amendment" }],
]);

export function amendmentLabel(a: AmendmentRecord): string {
  return `${LABEL.get(a.type)?.short ?? `${a.type} `}${a.number}`;
}

export function amendmentUrl(a: AmendmentRecord): string {
  return `https://www.congress.gov/amendment/${a.congress}${ordinal(a.congress)}-congress/${LABEL.get(a.type)?.path ?? "amendment"}/${a.number}`;
}

export function amendmentStatus(a: AmendmentRecord): Status {
  const t = a.latestAction?.text ?? "";

  if (!t && !a.actions.some((x) => x.text !== "" && !/submitted/iu.test(x.text))) {
    return "no_action";
  }

  if (/withdrawn/iu.test(t)) {
    return "withdrawn";
  }

  if (
    /not agreed|failed|ruled out of order|\bfell\b|not having achieved|motion to table[^.]*agreed|point of order[^.]*sustained/iu.test(
      t,
    )
  ) {
    return "failed";
  }

  if (/\bagreed to\b|adopted/iu.test(t)) {
    return "agreed";
  }

  return t ? "other" : "no_action";
}

export function rollId(a: AmendmentRecord): string | null {
  const action =
    a.actions.find((x) => x.text === a.latestAction?.text && x.votes.length > 0) ??
    a.actions.find((x) => x.votes.length > 0);

  const v = action?.votes[0];

  return v ? `${v.chamber.toLowerCase()}-${v.congress}-${v.session}-${v.roll}` : null;
}

export function lastActionDate(a: AmendmentRecord): string | null {
  return (
    a.actions
      .map((x) => x.date)
      .filter((d) => d !== "")
      .toSorted()
      .at(-1) ?? a.submittedOn
  );
}

const hasDate = <T extends { date: string | null }>(v: T): v is T & { date: string } =>
  v.date !== null && v.date !== "";

export function versionStep(when: string | null, versions: { code: string; date: string | null }[]): string | null {
  if (when === null || when === "") {
    return null;
  }

  for (const [i, b] of versions.entries()) {
    const a = versions[i - 1];
    const end = versions.slice(i).find(hasDate)?.date;

    if (a !== undefined && hasDate(a) && a.date <= when && (end === undefined || when <= end)) {
      return `${a.code}->${b.code}`;
    }
  }

  return null;
}

const isSubstitute = (a: AmendmentRecord, text: AmendmentText | null) =>
  /nature of a substitute/iu.test(a.purpose ?? "") || /strike (out )?all after/iu.test(text?.text.slice(0, 2000) ?? "");

function sectionIn(text: string, num: string) {
  const toc = new RegExp(`Sec\\. ${num}\\. (?<heading>[\\s\\S]{3,300}?)\\.\\s*\\n`, "u").exec(text);
  const start = text.search(new RegExp(`\\n\\s*SEC\\. ${num}\\. `, "u"));
  const rest = start < 0 ? "" : text.slice(start + 1);
  const end = rest.slice(10).search(/\n\s*SEC\. \d+[A-Z]?\. /u);

  return {
    heading: toc?.groups?.heading?.replaceAll(/\s+/gu, " ") ?? null,
    body: end < 0 ? rest : rest.slice(0, end + 10),
  };
}

interface StepInput {
  bill: BillId;
  from: string;
  to: string;
  agreed: { rec: AmendmentRecord; text: AmendmentText | null; when: string | null }[];
  added: Lineage[];
  removed: Lineage[];
  amended: Map<string, AmendmentText | null>;
}

const SHARE = 0.6;

export function attribute(s: StepInput): Row<"amendment_sections">[] {
  const rows: Row<"amendment_sections">[] = [];

  const texts = s.agreed
    .flatMap(({ text, ...a }) => (text ? [{ ...a, text, sh: shingles(text.text), canon: canon(text.text) }] : []))
    .toSorted((x, y) => x.canon.length - y.canon.length);

  const subs = s.agreed
    .filter((a) => isSubstitute(a.rec, a.text))
    .toSorted((x, y) => (x.when ?? "").localeCompare(y.when ?? ""));

  const stepLabel = `${s.from}->${s.to}`;

  const row = (
    a: AmendmentRecord,
    l: Lineage,
    how: "text" | "inferred",
    effect: "inserted" | "struck",
    rule: string,
    confidence: number,
    evidence: Row<"amendment_sections">["evidence"],
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
    const sec = must(l.history[s.to], `${l.id}'s step in ${s.to}`);
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
            sourceUrl: best.text.url,
            citation: best.text.citation,
            share: own.size ? Math.round((intersect(own, best.sh) / own.size) * 1000) / 1000 : null,
            alsoIn: others.map((o) => amendmentId(o.rec)),
          },
        ),
      );
      continue;
    }

    const only = s.agreed.length === 1 ? s.agreed[0] : undefined;
    const sub = subs.at(-1);

    if (only) {
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
    } else if (sub) {
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
  }

  for (const a of texts) {
    const struckNum = /\bStrike section (?<num>\d+[A-Za-z]*)\.\s*(?:_{3,}|$)/u.exec(a.text.text)?.groups?.num;
    const parent = a.rec.amends === null ? null : s.amended.get(a.rec.amends);

    if (struckNum === undefined || !parent) {
      continue;
    }

    const struck = sectionIn(parent.text, struckNum);
    const words = headingWords(struck.heading ?? "");
    const sh = shingles(struck.body);

    const scored = s.removed
      .map((l) => {
        const hw = headingWords(must(l.history[s.from], `${l.id}'s step in ${s.from}`).heading);
        const shared = intersect(words, hw);
        const small = Math.min(sh.size, l.last.sh.size);

        return {
          l,
          heading: shared / Math.max(1, words.size + hw.size - shared),
          wording: small ? intersect(sh, l.last.sh) / small : 0,
        };
      })
      .toSorted((x, y) => Math.max(y.heading, y.wording) - Math.max(x.heading, x.wording));

    const top = scored[0];

    if (top && (top.heading >= 0.5 || top.wording >= 0.3)) {
      rows.push(
        row(
          a.rec,
          top.l,
          "text",
          "struck",
          "amendment-strike: the amendment struckNum the substitute's section that carries this section's heading or wording",
          0.8,
          {
            sourceUrl: a.text.url,
            citation: a.text.citation,
            struck: `section ${struckNum} of ${a.rec.amends}`,
            headingInSubstitute: struck.heading,
            substituteUrl: parent.url,
            headingScore: Math.round(top.heading * 1000) / 1000,
            wordingScore: Math.round(top.wording * 1000) / 1000,
          },
        ),
      );
    }
  }

  return rows;
}

export async function loadText(a: AmendmentRecord): Promise<AmendmentText | null> {
  if (a.chamber !== "Senate") {
    return null;
  }

  const dates = [a.submittedOn, ...a.actions.map((x) => x.date)].flatMap((d) => (d === null || d === "" ? [] : [d]));

  return await senateAmendmentText(a.number, dates, textPages(a.actions));
}
