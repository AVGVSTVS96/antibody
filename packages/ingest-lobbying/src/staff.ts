const PREFIX =
  /\b(Rep|Representative|Congressman|Congresswoman|Cong|Sen|Senator|Speaker|Leader|Whip|Chairman|Chairwoman|Chair)\b\.?\s*/gi;

const NOT_A_NAME = new Set(
  (
    "Committee Cmte Comm Subcommittee Caucus Office Staff Small Business Commerce Banking Finance Judiciary Budget " +
    "Majority Minority Republican Democratic Dem House Senate Deputy Director Floor Counsel Advisor Policy Legislative " +
    "Chief Senior Assistant Aide Fellow Member Members Leadership Conference Appropriations Armed Services Energy " +
    "Health Rules Ways Means Foreign Relations Agriculture Intelligence Homeland Security Natural Resources Joint"
  ).split(" "),
);

const ROLE: Record<string, string> = {
  rep: "Rep.",
  representative: "Rep.",
  congressman: "Rep.",
  congresswoman: "Rep.",
  cong: "Rep.",
  sen: "Sen.",
  senator: "Sen.",
};

const titleCase = (w: string) => (w === w.toUpperCase() && w.length > 2 ? w[0] + w.slice(1).toLowerCase() : w);

/**
 * Members of Congress a covered position names, as written ("Chief of Staff, Rep. David Kustoff" →
 * "Rep. David Kustoff"). Resolve matches these to bioguide ids; the claim always quotes the position itself.
 */
export function namedMembers(position: string): string[] {
  const out = new Set<string>();
  for (const m of position.matchAll(PREFIX)) {
    const rest = position.slice(m.index! + m[0].length).split(/[,;(/\d–—]|\s-\s|\s{2,}/)[0]!;
    const words: string[] = [];
    for (const w of rest.trim().split(/\s+/)) {
      if (!/^[A-Z][A-Za-z'’.-]*$/.test(w) || words.length === 4) break;
      words.push(w);
    }
    while (words.length > 1 && /^(LD|LA|LC|COS|PSM)$/i.test(words.at(-1)!)) words.pop();
    if (!words.length || words.some((w) => NOT_A_NAME.has(w.replace(/[.,]$/, "")))) continue;
    if (words.length === 1 && words[0]!.length < 3) continue;
    const role = ROLE[m[1]!.toLowerCase()] ?? titleCase(m[1]!);
    out.add(`${role} ${words.map(titleCase).join(" ")}`);
  }
  return [...out];
}
