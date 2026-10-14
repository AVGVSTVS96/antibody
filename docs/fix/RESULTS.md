# fix (on main): results

Review findings from the live site, fixed on main in small signed commits (`9c349f9` to the last one in `git log`). Tests: 208 pass, 0 fail with data, 199+ pass without (`bun run test:nodata`). The 12 curated bundles rebuild byte for byte (checked twice on the real tables, ignoring `generatedAt`). Deployed to https://antibody-murex.vercel.app; `bun run e2e` passes (40/40 sampled source URLs answer 2xx).

## Majors

| Finding | Cause | Fix |
|---|---|---|
| CBO per-section join by number only, neighbouring rows merged | the House-passed file mixes two numberings; an "interaction" row with no section was read as a component of the section above | `ingest-cbo/src/headings.ts` + `sectionMap`: a number joins only if CBO's heading matches the section's; `py/cbo.py` starts a new row at an interaction line. Direct File is $15M. |
| Bundles not reproducible | unordered DuckDB reads; the claim cap kept an arbitrary 6 | total order on every query, claims sorted before the cap; test loads rows reversed |
| H.R.9772 watcher false positive, "just now" | title query matched the display title; `ago()` returns "just now" under an hour | query by bill number only; the pick shows its recorded time |
| CHIPS shown as "Legislative Branch Appropriations" | "Override Display Title" was ignored | `shortTitle()` prefers it; H.R.1 takes its name from its first section |
| `dollarsMusd` 2 to 3 times too big | every estimate and every group line summed | `core/dollars.ts` `sectionFigure`: one estimate (the latest), section lines only; the model and the score use the same function |
| "Added late" on shell bills | the first version was a shell, so everything was late | bills ingest withholds the flag (`late_unavailable`) for shells and wholesale rewrites; the page says so and hides the list |
| BenefitsCard / MembersCard wording and ranking | "Who benefits" implies gain; lists ranked by trade count | "Companies tied to the bill", "Members who traded those companies' stock", alphabetical, "Routine disclosures; no link to any vote is claimed." |
| 10-second test | long first card, map first on phone | verdict strip, roll calls collapsed, map behind "See the map" on phone, "news rank (100 = most covered)" instead of "pct" |
| Dead method links | `docs/rules.md` did not exist | written, a heading per rule; test checks every rule links to one |

## Minors fixed

docs/rules.md; donor gifts split before and after the member's vote; returned donations worded as returned; buried-v1 stakes ignore even splits and the rule says it is not symmetric; lobbying totals cite an lda.gov list query by client name (not one filing); eFD, FEC and SEC claims carry locators; "no floor action" now says what was checked; trades with a reused ticker (COR, CNR) left out and a name check marks the rest; section attention needs 30 mentions in total or shows raw counts only; join tests (CBO headings, OBBBA against CBO's table, lobbying total source, trade names, title fallback); BuriedCard reads `buried-v1`; every rule has real text and a URL; lobbyists with N/A, None or "See Form LD-1" are not drawn and the list is "Lobbyists who list a covered position"; party counts say "of N voters" with unread filers beside them; "Cut" is "Dropped", dollar colors are neutral, the estimate and baseline are in the cell's title; index cards show the vote tally, the sponsor's party and say what "members traded" counts; outlet list is linked and the unused wire and tv groups are gone.

## Left

- Duplicate lineage id `rh:title:I/subtitle:A/sec:10012` in H.R.1 (Nutrition dollars unjoined).
- IRA page weight (42 MB of JSON, claims are 35 MB): needs the claims sidecar.
- A renamed company is only marked, not matched across its old name; the ticker-reuse exclusions are two hand-checked pairs.
- The rest of PHASE1.md's open gaps (CBO coverage, unread paper filings, entity recall).
