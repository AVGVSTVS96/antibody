# antibody, Phase 1

**Live: https://antibody-murex.vercel.app** (Vercel project `antibody`, static, deployed from this machine with `bun run deploy`).

Phase 1 is the real v1: a site that x-rays 12 real bills (6 led by each party), a CLI that x-rays any bill, and a daily watcher. All ten build parts are merged into `main`. `bun run ci` passes: Biome, tsc 7, 197 tests.

Screenshots of the live site (index, GENIUS, one Democratic-led bill, 1440 and 390 wide, dark and light) are in `docs/shots/`.

## What works

```
antibody xray <bill>     every stage for one bill, then its bundle
antibody build           the 12 curated bills -> bundles + index -> apps/web/public/bundles
antibody watch           the daily watcher: finds moving bills, x-rays the top few, writes data/watch/<date>.md
bun run deploy           bundles + site build + Vercel deploy
bun run e2e <url>        headless Playwright check of a built site
```

| Piece | State |
|---|---|
| Bills | Text versions, sections with lineage across versions (splits, merges, late adds), sponsors, committees, amendments with who offered them, LLM-paired counterpart sections (labeled inferences) |
| CBO | Per-section dollars with the baseline named on every number; current-policy shown beside current-law where CBO gives it; section tables checked against CBO's printed totals (H.R.1 312/312, IRA 216/216) |
| Lobbying | lda.gov filings in all spellings, clients merged, lobbyists with covered positions quoted, spend with a labeled bill-share estimate, topic-only lines as dashed inferences |
| Trades | House PTRs 2019-2026 and Senate eFD: 100,984 trades, owner (self, spouse, joint, dependent) on every one, filing URL with page; 52,767 read by vision (Sonnet, about $246 API-equivalent) |
| Members and money | 1,916 members with dated terms, 100 roll calls, 12,661 votes, 1.74M contributions, 138K independent expenditures, employer sums |
| Entities | Lobbying clients, PAC sponsors, donor employers and trades resolved to public companies; hand-checked sample of 98 resolved names had 0 wrong |
| Attention | Media Cloud articles over a published, versioned 86-outlet list (left, center, right weighted equally; trade and legal coverage kept out of the score); per-section matching; `buried-v1` score with every sub-score stored |
| Store | Bundles built from the tables with minted claims; `checkBundle` finds no dangling claim or endpoint in any of the 12 |
| Web | Index (search, party-split curated bills, watcher picks), bill page (radial map, money map, X-ray list, source-chip cards), light and dark, phone to desktop |
| Watcher | Ran for real after the merge: 130 bills touched, 6 flagged, 1 x-rayed (S.195) in 131 s; its picks show on the live index |

Checks run on the live URL: index lists all 12 bills with both parties, GENIUS and the Inflation Reduction Act render the map, the Map / Money map / X-ray list toggle works, 981 and 6,048 source chips are all well-formed https record URLs, no console errors, no horizontal overflow at 390 wide, and a random 40 of the bundles' source URLs answer 2xx (the 2 to 3 that don't are 403/429 from bioguide.congress.gov and github.com blocking scripts).

## Fixed during integration

- Merge conflicts in `tables.test.ts`, `node.ts`, `bun.lock`, `.gitignore`, `main.ts` resolved with the contract winning; `bun.lock` regenerated.
- Store fixtures and the `funded` link follow the money part (`named_members`, `recipient_committee_id`).
- lda.gov answers 403 to any query containing a word that starts "Admin" ("Space Administration", "Administrative Pay-As-You-Go Act"), which stopped the lobbying stage on CHIPS, the Fiscal Responsibility Act and the omnibus. Such names are now searched by the stretch without the word; extraction still needs the full name.
- The index and bill card headlined the first CBO deficit found, so OBBBA showed the House-passed $2.4T instead of the enacted $3.4T. `headlineDeficit` in core now takes the latest published estimate, longest period (the IRA card now shows CBO's enacted-law estimate).
- Bill card showed BILLSTATUS twice and a doubled period; `$3394B` now reads `$3.4T`; watcher picks without a bundle show their real title.

## Gaps, biggest first

1. **No CBO dollars for 5 of the 12 bills.** Only 7 have a whole-bill deficit and only 5 have any per-section dollars (IRA 218, OBBBA 382, ARPA 63, omnibus 79). The cards say "No CBO score" or "whole-bill numbers only", which is honest but thin. Verified cause for the Fiscal Responsibility Act: CBO's `Table-1-hr3746.xlsx` is in billions with the label in column B, and the `table1` parser returns 0 rows. IIJA has 2 estimate rows and 0 lines (House Rules drafts, not diagnosed). S.3373, S.5 and S.146 have no estimate listed in BILLSTATUS at all.
2. **"Late" means nothing on shell-vehicle bills.** 266 of 267 sections of H.R.4346 (CHIPS), 546 of 632 IIJA, 1,132 of 1,133 NDAA and 1,864 of 1,865 omnibus are flagged late because the first version was a short shell. Their rings are uniform and none of them can get a `buried` label. Cause: `sections.late` compares against the first version; it should compare against the first version with the bill's real text.
3. **CHIPS shows its BILLSTATUS title, "Legislative Branch Appropriations Act, 2022"**, not the name of the law it became. Same shell cause; the curated list in `apps/cli/src/curated.ts` has the right name but the card uses the bill's own title.
4. **Bundles are big and not in git.** 12 bundles are 170 MB (IRA 41 MB, 4.6 MB over the wire with brotli); claims are most of it. They are gitignored and uploaded by `bun run deploy`, so a fresh clone has no data until `antibody build`. Fix: move `claims` into a sidecar file loaded on the first source click.
5. **Paper filings unread.** 261 filings (about 1,000 pages, mostly old paper filings) are unread, 4,592 vision rows are flagged `needs_second_read` and the second read has not run, 868 vision rows had no readable owner or type and were dropped. Every bill lists "paper filings not yet read" with the member count (2 to 25).
6. **11 rows left out of bundles** (IRA 6, OBBBA 2, omnibus 2, TAKE IT DOWN 1): a claim rests on an `lda_clients` row that is not in the tables. Listed in `data/bundles/<bill>.warnings.txt`. One duplicate section id in H.R.1 (`sec:10012`) is skipped.
7. **Entity recall is 15 to 30%**: for example 634 of 3,192 lobbying clients on OBBBA resolve to a public company. The rest are trade groups, nonprofits and private firms, named in each bundle's gap list. Donor employers below $25K in total are matched by name only.
8. **Section-level attention is soft.** Whether an article is about the bill agrees 96% between Sonnet and Opus; which section it names agrees about 0.25 (Jaccard). Rows are labeled inferences at 0.75. Without per-section CBO dollars no `buried` label can be given (gap 1).
9. **Independent expenditures have rows but no edge kind**, so outside spending is not in the bundles. Votes are tallied with the party a member held on the vote date only where store reads `terms`; the money part asked for a check of this.
10. **Watcher**: dollars and buried show "—" for bills that are not x-rayed, so a big bill outside the top 25 on the cheap score could be missed (`ANTIBODY_WATCH_ENRICH` widens it). Floor action by voice vote or unanimous consent is not counted as rushed. Simple resolutions are left out on purpose.
11. **Not scheduled.** `scripts/daily.sh` (watcher, then deploy) and a systemd timer for 6 am are in `scripts/systemd/` but not enabled, because each run x-rays 3 bills with Sonnet and plans are tight. Enable with `systemctl --user enable --now antibody-daily.timer` after copying both files to `~/.config/systemd/user/`.
12. **Not connected to git on Vercel.** Deploys go from this machine (`bun run deploy`); pushing to GitHub does not redeploy.
13. Smaller: Media Cloud's partisanship quintiles are from 2019 and the center-right group has one outlet; two CSS specificity warnings in Biome; the index page's `<link rel=preload>` for `index.json` keeps one request open in headless Chromium (harmless, `networkidle` never settles, so the scripts wait for a selector instead).

## What each part left open

- **bills**: counterpart pairing only runs where a removed section has candidate added sections (IRA, GENIUS: 0 rows); who offered a late insertion is named only where the Congressional Record shows the amendment text; predecessor bills are found by short title and section carry-over only.
- **cbo**: many IRA estimates are House Rules or Senate drafts with no readable table (estimate row, 0 lines); CHIPS-style bills that scored unpublished text get whole-bill numbers only; a PDF layout it does not know falls back to the summary or `table1.xlsx`, and if neither parses there are no lines; wrapped section titles in CBO PDFs can lose a trailing word (the site shows titles from the bill text).
- **lobbying**: a bill named only by nickname ("the big bill") is found only by the topic-only stage; a name next to another bill's number is held out, which loses a few real lines; `lda_lobbyists` rows are shared across bills so readers filter by `bill_ids`; an anonymous lda.gov key allows 15 requests a minute, `LDA_API_KEY` 120.
- **trades**: 927 trades have no ISO date (the date stays as filed); 305 have no amount range (mostly brokerage-statement attachments); 19 filings of members who sponsored an ingested bill are partial.
- **money** (members, fec): congress.gov beta House votes skipped (need an api.data.gov key; the Clerk XML covers the same votes); individual money to leadership PACs is not summed by employer; a roster is one snapshot per Congress.
- **entities**: parent and subsidiary ownership is the model's knowledge, checked against SEC's list only (Calpine was missed); verdicts are a mix of Opus (about 3,000) and Sonnet; donor-employer matches were read by eye, not against a labeled file; bonds, structured notes and bank-branded funds are out of the headline tier.
- **attention**: 118-hr-3746 had no sections when attention first ran, so it was matched in this integration run only through the `build` pipeline; late flags on shell vehicles (gap 2).
- **bundle**: claims sidecar (gap 4); the `warnings.txt` rows (gap 6).
- **web**: only the pages above exist; a pre-render step for the client-rendered pages is a later speedup; Playwright full-page phone screenshots repeat sections (a stitching artifact, the DOM has one copy).
- **watch**: gap 10.

## Run it

```
bun install
bun run antibody build              # re-runs every stage for the 12 bills (hours cold, minutes warm), then publishes
bun run antibody build --no-stages  # bundles and index from the tables already on disk
bun run --cwd apps/web build && (cd apps/web && bunx vite preview --port 4870)
bun run e2e http://localhost:4870
bun run deploy
```

Data lives in `data/` (gitignored, shared by every worktree). Heavy jobs run under `systemd-run --user --scope -p MemoryMax=4G -p CPUWeight=20`. Vision and the model passes need `claude` on PATH.
