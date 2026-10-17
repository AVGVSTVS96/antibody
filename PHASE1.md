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
| Attention | Media Cloud articles over a published, versioned 86-outlet list (left, center, right weighted equally; trade and legal coverage kept out of the score); per-section matching; `buried-v2` score with every sub-score stored (see "Buried audit" below) |
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

## Fixed after review

The review of the live site found these; each is fixed on main with a test where one fits.

- **CBO per-section dollars.** A bill's section number now joins a CBO row only when CBO's own heading matches the section's heading (the House-passed file mixes two numberings); interaction rows no longer fold into the section above (Direct File is $15M, not $2.1B); a group line's total is no longer added on top of its shares; a section shows one estimate, the latest, with its baseline named. OBBBA §71119 and §70120 are checked against CBO's printed table by a data-guarded test.
- **Bundles rebuild byte for byte.** Every query has a total order and claims are sorted before they are capped; a test loads the rows reversed and compares. Two rebuilds on the real tables are identical apart from `generatedAt`.
- **Watcher.** A bill is matched on lda.gov by its number only (the title query matched H.R.9772 by accident), and pick times show the real detection time, not "just now".
- **Titles.** CHIPS shows its law's name; H.R.1 takes "One Big Beautiful Bill Act" from its first section when BILLSTATUS lists only a description.
- **"Added late" on shell bills.** Bills that began as a shell or were rewritten wholesale (CHIPS, the omnibus, NDAA, IIJA, PACT Act) say the late flag is unavailable and hide the list instead of flagging nearly every section.
- **Stakes.** `dollarsMusd` counts one estimate per section, and an even share of a grouped line is shown but does not count toward stakes (the asymmetry is stated in the rule, `docs/rules.md`).
- **Wording.** Refunded donations read as returned; amendments with no action say "none recorded on congress.gov"; the member and company cards are named for what they list ("Companies tied to the bill", "Members who traded those companies' stock"), listed alphabetically, with "Routine disclosures; no link to any vote is claimed."; lobbyists whose covered position is N/A, None or "See Form LD-1" are no longer drawn.
- **Donor timing.** Each PAC gift to a member is split into before and after the member's passage vote (enactment when they cast none), and both are shown.
- **Trades.** A ticker reused by another company (COR as CoreSite, CNR as Cornerstone) is left out and counted in the bundle warnings; a trade whose asset name shares no word with the company's SEC name is kept and marked.
- **Sources.** A lobbying total cites an lda.gov list of the client's filings that name the bill, not one arbitrary filing; eFD, FEC and SEC claims carry a locator saying the site turns scripts away and what to look for.
- **Attention.** A bill with fewer than 30 section mentions (the omnibus, the NDAA) shows raw counts and no rank. The page says "news rank, 100 = most covered" instead of "pct".
- **Layout.** A verdict strip (loudest, quiet with big stakes, money) sits above the page, roll calls are collapsed, and on a phone the map is behind "See the map". Index cards show the final vote tally and the sponsor's party; "members traded" says what it counts. Party counts say of how many voters, with unread paper filers beside them.
- **Method links.** `docs/rules.md` exists with a heading per rule; a test checks every published rule has one and that no rule's text is its id.
- **Rows left out of bundles** : client claims fell back to no source; they now fall back to an lda.gov client query, and only the trade exclusions remain in the warnings files.
- **Unused outlet groups** (wire, tv) are gone from the schema; the outlet list is linked from the headline card.

## Gaps still open, biggest first

1. **No CBO dollars for 5 of the 12 bills.** Only 7 have a whole-bill deficit and only 5 have any per-section dollars (IRA 218, OBBBA 382, ARPA 63, omnibus 79). The cards say "No CBO score" or "whole-bill numbers only", which is honest but thin. Verified cause for the Fiscal Responsibility Act: CBO's `Table-1-hr3746.xlsx` is in billions with the label in column B, and the `table1` parser returns 0 rows. IIJA has 2 estimate rows and 0 lines (House Rules drafts, not diagnosed). S.3373, S.5 and S.146 have no estimate listed in BILLSTATUS at all.
2. **Bundles are big and not in git.** 12 bundles are 170 MB (IRA 41 MB, 4.6 MB over the wire with brotli); claims are most of it. They are gitignored and uploaded by `bun run deploy`, so a fresh clone has no data until `antibody build`. Fix: move `claims` into a sidecar file loaded on the first source click.
3. **Paper filings unread.** 261 filings (about 1,000 pages, mostly old paper filings) are unread, 4,592 vision rows are flagged `needs_second_read` and the second read has not run, 868 vision rows had no readable owner or type and were dropped. Every bill lists "paper filings not yet read" with the member count (2 to 25).
4. **Entity recall is 15 to 30%**: for example 634 of 3,192 lobbying clients on OBBBA resolve to a public company. The rest are trade groups, nonprofits and private firms, named in each bundle's gap list. Donor employers below $25K in total are matched by name only.
5. **Section-level attention is soft.** Whether an article is about the bill agrees 96% between Sonnet and Opus; which section it names agrees about 0.25 (Jaccard). Rows are labeled inferences at 0.75. Without per-section CBO dollars a section can still be buried through lobbying alone.
6. **Independent expenditures have rows but no edge kind**, so outside spending is not in the bundles. Votes are tallied with the party a member held on the vote date only where store reads `terms`; the money part asked for a check of this.
7. **Watcher**: dollars and buried show "—" for bills that are not x-rayed, so a big bill outside the top 25 on the cheap score could be missed (`ANTIBODY_WATCH_ENRICH` widens it). Floor action by voice vote or unanimous consent is not counted as rushed. Simple resolutions are left out on purpose.
8. **Not scheduled.** `scripts/daily.sh` (watcher, then deploy) and a systemd timer for 6 am are in `scripts/systemd/` but not enabled, because each run x-rays 3 bills with Sonnet and plans are tight. Enable with `systemctl --user enable --now antibody-daily.timer` after copying both files to `~/.config/systemd/user/`.
9. **Not connected to git on Vercel.** Deploys go from this machine (`bun run deploy`); pushing to GitHub does not redeploy.
10. **One section in H.R.1 is dropped by a duplicate id** (`rh:title:I/subtitle:A/sec:10012` appears twice in the bills stage), so the Nutrition section's dollars stay unjoined. Cause: the lineage id is built from the path alone.
11. **The IRA page still loads slowly** (42 MB of JSON, 5 MB over the wire; claims are 35 MB of it). Fix is the claims sidecar in gap 2; not started.
12. **Trades are joined to companies by ticker, then checked by name.** A renamed company (Facebook to Meta, Raytheon to RTX) is kept and marked "names the company differently"; a reused ticker is only excluded where someone has checked it by hand (two pairs).
13. Smaller: Media Cloud's partisanship quintiles are from 2019 and the center-right group has one outlet; two CSS specificity warnings in Biome; the index page's `<link rel=preload>` for `index.json` keeps one request open in headless Chromium (harmless, `networkidle` never settles, so the scripts wait for a selector instead).

## What each part left open

- **bills**: counterpart pairing only runs where a removed section has candidate added sections (IRA, GENIUS: 0 rows); who offered a late insertion is named only where the Congressional Record shows the amendment text; predecessor bills are found by short title and section carry-over only.
- **cbo**: many IRA estimates are House Rules or Senate drafts with no readable table (estimate row, 0 lines); CHIPS-style bills that scored unpublished text get whole-bill numbers only; a PDF layout it does not know falls back to the summary or `table1.xlsx`, and if neither parses there are no lines; wrapped section titles in CBO PDFs can lose a trailing word (the site shows titles from the bill text).
- **lobbying**: a bill named only by nickname ("the big bill") is found only by the topic-only stage; a name next to another bill's number is held out, which loses a few real lines; `lda_lobbyists` rows are shared across bills so readers filter by `bill_ids`; an anonymous lda.gov key allows 15 requests a minute, `LDA_API_KEY` 120.
- **trades**: 927 trades have no ISO date (the date stays as filed); 305 have no amount range (mostly brokerage-statement attachments); 19 filings of members who sponsored an ingested bill are partial.
- **money** (members, fec): congress.gov beta House votes skipped (need an api.data.gov key; the Clerk XML covers the same votes); individual money to leadership PACs is not summed by employer; a roster is one snapshot per Congress.
- **entities**: parent and subsidiary ownership is the model's knowledge, checked against SEC's list only (Calpine was missed); verdicts are a mix of Opus (about 3,000) and Sonnet; donor-employer matches were read by eye, not against a labeled file; bonds, structured notes and bank-branded funds are out of the headline tier.
- **attention**: 118-hr-3746 had no sections when attention first ran, so it was matched in this integration run only through the `build` pipeline; late flags on shell vehicles (late flags are withheld there now).
- **bundle**: claims now ship in a `<bill>.claims.json` sidecar (the page paints with ghost chips, then fills them); the main files are still 6 to 9 MB raw for the largest bills.
- **web**: only the pages above exist; a pre-render step for the client-rendered pages is a later speedup; Playwright full-page phone screenshots repeat sections (a stitching artifact, the DOM has one copy).
- **watch**: gap 7.

## Left open after round 1 of the Phase 2 fixer

Fixed: the CBO parser (ARPA section 2922 no longer shows a whole-bill figure; nonscorable revenues are their own measure), lobbying total claims that cite filings instead of an unreproducible list query, the S.146 public-law join, duplicate section ids in one text version, the late gate and title count in buried-v1, attention wording and its method-page source, and the claims sidecar. Not done:

- map hairball (labels, edge alpha, ring captions), stat tiles, layout order, index card hooks, small low-contrast text, mobile map preview
- whole-bill totals for FRA, IIJA, NDAA and ARP; the IRA still lists estimates from several dates in one line
- trade-tie baseline and window; subsidiary acquisition dates; committee roster as-of dates; "Hearings by" wording; primary tickers only
- the watcher: stale digest, title-based lobbying counts, "hot" cutoff and party audit; the "not tested" coverage state
- a 119th Democratic-led and a 117th Republican-led bill in the curated set
- the attention rows for the second H.R.1 section were not recomputed

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

## Buried audit (2026-10-16)

The site showed 0 quiet-and-costly sections on 21 of 22 bills. Causes, fixes and per-bill before/after numbers are in the audit report; in the code:

- `buried-v2` (`docs/rules.md`, `packages/analyze/src/score.ts`): costly (CBO $10B for the section, or 21 lobbying reports) and quiet (under 1 in 100 articles) is buried; late and off-topic only rank. A bill under 10 sections, with unranked news or with no measured cost says it cannot be tested.
- `quiet-check` stage and `attention_checks` table: a second look at costly sections before they are called quiet.
- CBO parser (`packages/ingest-cbo`): division, title and provision tables (CHIPS, IIJA, FRA, NDAA, the omnibus), estimates of a bill that carried the same text (PACT via H.R.3967); `cbo_lines.join` says how a row was tied to sections.
- News: press-name searches for the omnibus, PACT Act, NDAA and Lend-Lease; the default search drops "of 2025" from a short title.
- Still open: bills with no per-section CBO figure (appropriations, authorizations, whole-bill-only estimates) cannot be tested; amounts in the bill text are the public source that could cover them.
