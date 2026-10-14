# ingest-bills

Any bill id in, every text version, section, lineage step, sponsor, committee, amendment and counterpart out. Stage `bills` (per bill) writes `bills, versions, sections, sponsorships, bill_committees, amendments, amendment_sections, counterparts`. It runs in its own `heavy()` process.

    bun run antibody run bills 118-hr-3935      # fresh bill, no spike data: 67 s, 12 model calls, $0.83 at list price (sonnet)

## What it does

| piece | file | notes |
|---|---|---|
| fetch | `fetch.ts`, `versions.ts` | BILLSTATUS and every BILLS-/PLAW- version from GovInfo bulk files, cached in `data/bills/` |
| BILLSTATUS | `billstatus.ts` | bill, sponsors and cosponsors (with withdrawn dates), committees, actions, amendments |
| sections | `sections.ts`, `xml.ts` | USLM parser; sections quoted into other law and struck text are not the bill's own |
| lineage | `match.ts`, `lineage.ts`, `diff.ts` | exact path, then text match across versions; per-version history with similarity and words added/removed |
| fix 1 | `match.ts` | a same-law match needs 0.15 text similarity; a shared cited law alone does not count |
| fix 2 | `lineage.ts` | `late` comes from the lineage (first appears after the first chamber text); the old side of a split says `split_into`, not removed; pieces split out show "split from", flagged only if their text changed |
| predecessors | `predecessor.ts` | earlier bills found by short title and section carry-over (S.394 before GENIUS S.1582), labeled inference |
| amendments | `amendments.ts`, `crec.ts` | status from the latest action, roll call, version step; the Congressional Record text says which sections an amendment inserted or struck, so `amendment_sections` names who offered a late insertion (bioguide through `amendments.sponsor`) |
| counterparts | `counterparts.ts` | `claude -p --model sonnet` pairs leftover removed/added sections; each pair is an inference with the model's reason and a confidence; answers cached by prompt in `data/bills/llm/` |

## Tests (49 in the repo, `bun run ci` green)

- `genius.test.ts`: GENIUS from gzipped GovInfo fixtures, runs in CI (no network, no model).
- `big-bills.test.ts`: H.R.1 (119th, Republican-led) and the IRA H.R.5376 (117th, Democrat-led) from the downloads in `data/bills/`; skipped where they are missing (CI). Same assertions style for both: version chain, split of the House "Safety net" section into the Senate's 21 pieces, rewritten gambling-loss match, 4 House-floor + 112 Senate-floor late sections in the final law, Ernst/Blackburn/Rules Committee attribution, the $4B drought section as a late add, every same-law match at least 0.15 similar, 153 sections in the final IRA with Senate adds tied to substitute SA 5194.
- `unit.test.ts`: text canon, citation extraction, section parsing, matching, splits, amendment status and version step.

## Calls and limits

- Counterpart model is Sonnet (Bassim's switch, Oct 13 11:15pm). The 28 H.R.1 counterpart rows already in `data/out/counterparts/` came from the earlier Opus 5.5 run; each row's `evidence.model` says which. A rerun uses Sonnet; the cache key includes the model.
- Counterparts are only attempted when a removed section has candidate added sections that share heading words, cited law or wording; most bills have none (IRA, GENIUS: 0 rows).
- Who offered a late insertion is only named where the Record shows the amendment text; otherwise the section has no `amendment_sections` row.
- Sponsorships are written here (the `money` branch dropped its own sponsors stage).
- Nothing blocked.
