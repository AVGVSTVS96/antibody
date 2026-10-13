const billKey = process.argv[2]!;
const path = new URL(`../../data/lobbying/${billKey}/matches.jsonl`, import.meta.url).pathname;
const memberRe = /\b(?:Rep\.|Representative|Congressman|Congresswoman|Sen\.|Senator|Leader|Speaker|Chairman|Chairwoman|Whip)\s+((?:[A-Z][a-zA-Z'’.-]+\s?){1,3})/g;
const committeeRe = /\b(?:Senate|House)\s+(?:Committee\s+on\s+)?([A-Z][A-Za-z,&\s]{3,60}?)\s+Committee\b|\bCommittee on ([A-Z][A-Za-z,&\s]{3,60})/g;
const seen = new Map<number, { name: string; pos: string; members: string[]; committees: string[] }>();
for (const line of (await Bun.file(path).text()).trim().split("\n")) {
  const m = JSON.parse(line);
  if (m.confidence === "low" || m.superseded) continue;
  for (const a of m.activities) for (const l of a.lobbyists) {
    if (!l.covered_position || seen.has(l.id)) continue;
    const members = [...l.covered_position.matchAll(memberRe)].map((x) => x[1].trim());
    const committees = [...l.covered_position.matchAll(committeeRe)].map((x) => (x[1] ?? x[2]).trim());
    seen.set(l.id, { name: l.name, pos: l.covered_position, members, committees });
  }
}
const all = [...seen.values()];
const withMember = all.filter((x) => x.members.length);
const memberCounts = new Map<string, number>();
for (const x of withMember) for (const n of new Set(x.members)) memberCounts.set(n, (memberCounts.get(n) ?? 0) + 1);
console.log(JSON.stringify({ covered_lobbyists: all.length, naming_a_member: withMember.length, naming_a_committee: all.filter((x) => x.committees.length).length, top_former_bosses: [...memberCounts].sort((a, b) => b[1] - a[1]).slice(0, 15) }, null, 1));
