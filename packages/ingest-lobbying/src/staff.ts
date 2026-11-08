const PREFIX =
  /\b(Rep|Representative|Congressman|Congresswoman|Cong|Sen|Senator|Speaker|Leader|Whip|Chairman|Chairwoman|Chair)\b\.?\s*/giu;

const NOT_A_NAME = new Set(
  (
    "Committee Cmte Comm Subcommittee Caucus Office Staff Small Business Commerce Banking Finance Judiciary Budget " +
    "Majority Minority Republican Democratic Dem House Senate Deputy Director Floor Counsel Advisor Policy Legislative " +
    "Chief Senior Assistant Aide Fellow Member Members Leadership Conference Appropriations Armed Services Energy " +
    "Health Rules Ways Means Foreign Relations Agriculture Intelligence Homeland Security Natural Resources Joint"
  ).split(" "),
);

const ROLE = new Map(
  Object.entries({
    rep: "Rep.",
    representative: "Rep.",
    congressman: "Rep.",
    congresswoman: "Rep.",
    cong: "Rep.",
    sen: "Sen.",
    senator: "Sen.",
  }),
);

const titleCase = (w: string) => (w === w.toUpperCase() && w.length > 2 ? w[0] + w.slice(1).toLowerCase() : w);

export function namedMembers(position: string): string[] {
  const out = new Set<string>();

  for (const m of position.matchAll(PREFIX)) {
    const rest = position.slice(m.index + m[0].length).split(/[,;(/\d–—]|\s-\s|\s{2,}/u)[0] ?? "";
    const words: string[] = [];

    for (const w of rest.trim().split(/\s+/u)) {
      if (!/^[A-Z][A-Za-z'’.-]*$/u.test(w) || words.length === 4) {
        break;
      }

      words.push(w);
    }

    while (words.length > 1 && /^(LD|LA|LC|COS|PSM)$/iu.test(words.at(-1) ?? "")) {
      words.pop();
    }

    if (!words.length || words.some((w) => NOT_A_NAME.has(w.replace(/[.,]$/u, "")))) {
      continue;
    }

    if (words.length === 1 && (words[0]?.length ?? 0) < 3) {
      continue;
    }

    const title = m[1] ?? "";
    const role = ROLE.get(title.toLowerCase()) ?? titleCase(title);
    out.add(`${role} ${words.map(titleCase).join(" ")}`);
  }

  return [...out];
}
