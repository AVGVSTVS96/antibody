# bundle part: store + CLI (`xray`, `bundle`, `build`)

Branch `p1/bundle`. `bun run ci` passes (Biome, tsc, 62 tests).

## What exists

- `packages/store`: `buildBundle(db, billId)` turns the contract tables into one `Bundle` (nodes, edges, claims, gaps, rules).
  Store mints every claim's wording from the row (one template per table), so wording is identical for every party.
  `trimEvidence` keeps 6 claims per edge (`Edge.moreClaims` counts the rest) and drops claims nothing points at.
  Lobbying bundles draw the 300 clients with most reports (plus company-resolving ones); each member's 5 largest PAC donors; the rest is named in a gap.
  `loadTables` survives bad shards: duplicate ids skipped, a table that breaks its constraints stays empty, both reported.
  `writeBundle` leaves a published copy alone when only `generatedAt` differs. `writeIndex` writes `index.json` with per-bill stats, `origin`/`note`/`addedOn` and the watcher's picks; curated bills first in `CURATED` order, then watcher bills newest added first. Every published page stays.
- `apps/cli`:
  - `antibody xray <bill> [--refresh] [--publish]`: every bill stage in dependency order, then the bundle.
  - `antibody bundle <bill>... [--publish]`: bundles from the tables as they are (no stages).
  - `antibody build [--refresh] [--no-stages]`: the curated list, publishes bundles + `index.json` to `apps/web/public/bundles/`.
  - A failing bill is reported and the rest continue; exit code 1 lists the failures. Global stages run once per `build`.
  - `packages/store/src/curated.ts`: 12 bills, six led by each party (sponsor party of the measure that became law), each id/sponsor/law number checked against GovInfo BILLSTATUS on 2026-10-13:
    GENIUS 119-s-1582 (R), IRA 117-hr-5376 (D), OBBBA 119-hr-1 (R), American Rescue Plan 117-hr-1319 (D), Laken Riley 119-s-5 (R), CHIPS 117-hr-4346 (D), TAKE IT DOWN 119-s-146 (R), IIJA 117-hr-3684 (D), Fiscal Responsibility Act 118-hr-3746 (R), PACT Act 117-s-3373 (D), NDAA FY2026 119-s-1071 (R), Consolidated Appropriations 2023 117-hr-2617 (D).

## Run against the current shared data (Oct 14, 01:00)

`antibody bundle` on the tables in `data/out` built 8 of the 12 with `checkBundle` clean:

| bill | sections | nodes | edges | claims | size |
|---|---|---|---|---|---|
| 119-s-1582 | 20 | 1122 | 2922 | 7352 | 5.6 MB |
| 119-hr-1 | 480 | 3454 | 5077 | 31046 | 23.6 MB |
| 117-hr-5376 | 844 | 4198 | 11259 | 56995 | 40.6 MB |
| 117-hr-1319 | 240 | 2113 | 2714 | 19319 | 14.4 MB |
| 117-hr-3684 | 1044 | 159 | 617 | 2545 | 3.4 MB |
| 117-hr-4346 | 295 | 99 | 356 | 805 | 1.0 MB |
| 119-s-5 | 3 | 605 | 679 | 1614 | 1.1 MB |
| 119-s-146 | 5 | 680 | 1812 | 4246 | 3.2 MB |

Not built yet: 118-hr-3746, 117-s-3373, 119-s-1071, 117-hr-2617 have no `bills` rows. They need `antibody run bills <id>` (p1/bills, not merged here), then the other parts' stages.

## Open points

- Size: IRA is 40 MB raw (about 5 MB gzip, 2.5 MB brotli; claims are 33 MB of it, mostly lda_filings, trades and contributions quotes). Vercel serves brotli, so loading is fine, but committing the published copies to git grows the repo with every changed rebuild. If that hurts, the cheap fix is moving `claims` into a sidecar `<bill>.claims.json` the web loads on first source click; it needs a web change, so left for integration.
- Rows left out by a missing parent (6 on IRA, 1 on TAKE IT DOWN) are listed in `data/bundles/<bill>.warnings.txt`: a claim resting on a `lda_clients`/`resolutions` row the lobbying part didn't write. Owner: lobbying/entities.
- `independent_expenditures` fails to load (NOT NULL `date`): the money part writes rows with an empty date. Owner: money.
- 1 duplicate section id in 119-hr-1 (`...sec:10012`) is skipped in `sections`, `attention` and `section_scores`. Owner: bills.
- Other parts' branches (p1/*) are not merged into p1/bundle; integration (scratch/bundle-int, scratch/int2) does that.
