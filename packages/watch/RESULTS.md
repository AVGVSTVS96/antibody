# watch

`bun run antibody watch` is the daily job: one command, one exit code, no scheduler setup. It finds bills that moved, ranks them on impact and sneakiness with the same weights for every party, x-rays the top few, and writes `data/watch/<date>.md` + `<date>.json`, puts what it x-rayed on the site and redeploys it.

Exit code: `0` clean. `2` digest written but a source, lookup or x-ray failed (each failure is listed under "problems" in the digest). Any other non-zero: nothing usable (e.g. every discovery source down).

## What it does

| Step | How | Where |
|---|---|---|
| Find movers | 9 free sources: GovInfo BILLSTATUS bulk sitemaps (records updated since the last digest, at most 14 days back; 3 days on a first run), GovInfo new text versions (committee, engrossed, enrolled, conference), CBO's own feed for new estimates. Actions dated up to 7 days before the window count too (BILLSTATUS records actions late). | `discover.ts`, `billstatus.ts` |
| Events | Per bill: passed, passed second chamber, failed, recorded floor vote (House/Senate roll or tally), conference, enrolled, presented, became law, reported, new text, CBO estimate. Event ids are stable, so a later run never reports the same event twice; a same-day rerun rebuilds that day's digest. | `events.ts` |
| Score | 100 x sum of weight x sub-score. Eight sub-scores: moving 20%, size 10%, dollars 15% (CBO whole-bill deficit, current-law baseline named), lobbying 15% (LD-2 filings naming the bill), late 15% (sections first seen after the first chamber passed it), rushed 10% (days from text public to recorded floor vote; closed rule floors it at 0.5), buried 10% (x-ray label), divisive 5% (closest recorded vote). An unmeasured sub-score shows "—" and counts 0. The sponsor's party is not an input anywhere. | `score.ts` |
| Enrich | Top 25 by cheap score get bill text read (size, late sections by heading diff against the first-passed text) and an LDA filings search. | `text.ts`, `lda.ts` |
| X-ray | Top 3 run `antibody xray <bill>` in their own process (60 min cap, log kept). When their tables exist, the x-ray's lineage, CBO lines, lobbying and buried labels replace the watcher's estimates. | `xray.ts` |
| Publish | Each x-rayed bill's bundle is parsed and run through `checkBundle`; a sound one is copied to `apps/web/public/bundles` (bundle + `.claims.json`), a failing one is listed as a problem and left out. The 14 curated bundles are never overwritten. | `site.ts` |
| Digest | Top 5 as cards, 10 more in a table, each with its sub-scores, the reasons in plain words (each with a source link), and links to its site page (when published), congress.gov, newest text and BILLSTATUS. The ranking rules are printed at the end, with a party symmetry audit (flagged vs moved, by sponsor party). | `digest.ts` |
| Record | `watch_events`: every new event plus one `hot` row per flagged bill (reason, score, sub-scores, facts, bundle path) for the site's watch list. Saved before the site step, and the digest is saved before and after it, so a deploy that hangs or fails loses nothing. | `watch.ts` `recordEvents` |
| Site | `index.json` is rebuilt (`writeIndex`): the 14 curated bills first in their `CURATED` order, then watcher bills newest added first, capped at 60 (older ones are dropped from the index and their files deleted; they stay in `data/bundles`). Picks are this run's flagged bills and link to a bundle when one is published. Then `bun run --cwd apps/web build`, `bunx vercel build --prod --yes` and `bunx vercel deploy --prebuilt --prod --yes` run memory-capped from the repo root (the Vercel project's root directory is `apps/web`). The deploy is skipped when the new index equals the one at the last successful deploy apart from `generatedAt` (kept in `data/watch/deployed-index.json`). A failed deploy leaves the live site as it was (Vercel only switches production when the new build is ready), is a problem in the digest, and the next run retries. | `site.ts` |

Watcher bills are marked in `index.json` with `origin: "watcher"`, `addedOn` (first day the watcher flagged it) and a `note` saying what is thinner than a curated bill (not hand-checked; buried sections not ranked when news coverage was too thin; no CBO estimate). Curated bills have `origin: "curated"`, `note` and `addedOn` null. Same stages, same entity matching and same model review run for both; what differs is the hand-checking of ids, sponsor and law, and that watcher bills are mostly short, so news coverage is usually too thin to rank buried sections.

Knobs (env): `ANTIBODY_WATCH_XRAYS` (3), `ANTIBODY_WATCH_ENRICH` (25), `ANTIBODY_WATCH_SINCE` (date override), `ANTIBODY_WATCH_XRAY_MINUTES` (60), `ANTIBODY_WATCH_PUBLISH` (on; `0` keeps bundles off the site), `ANTIBODY_WATCH_DEPLOY` (on; `0` or `antibody watch --no-deploy` builds nothing and deploys nothing, for tests and dry runs), `ANTIBODY_PAGE_URL` (digest page link, default `https://antibody-murex.vercel.app/bill/{id}`).

## Checked

- `bun run ci`: Biome, tsc, 39 tests (BILLSTATUS parse on a real record, event classification, closed-rule detection, vote clock, scale endpoints, party symmetry: the same facts score the same for R and D sponsors, digest markdown/JSON).
- Live run on the real week of Oct 6-13 2026: 9/9 sources, 1,109 bills touched, 81 moved with new events, 15 flagged, 84 s with no x-ray, 33 s with one. Mostly enrolled commemorative/land bills, which is what moved that week; sponsors 61 R / 20 D among movers, 14 R / 1 D among flagged, shown in the digest's audit line.
- Backtest (`bun packages/watch/src/backtest.ts`, past weeks as if the watcher had run): OBBBA final week 87.9, IRA final week 80.5, GENIUS House week 53.5, GENIUS Senate week 48.6. The two biggest reconciliation fights, one per party, land within 7 points of each other with the same rules; the CBO baseline is named on each dollar line.
- Dry run of the publish step on the 8 bundles the watcher had x-rayed (Oct 14-16), deploy off: all 8 pass `checkBundle`, all published, `index.json` lists them as `watcher` after the 14 curated bills, newest added first, with the 3 picks of Oct 16 linked to their bundle. Real end-to-end run on 2026-10-16 (x-ray of 3 bills, publish, index, production deploy, memory-capped): 21.7 min, exit 0; 22 bills and 3 picks live on antibody-murex.vercel.app.
- Exit code 2 verified: an x-ray that finishes without a bundle is a listed problem.

## Not done / blocked

- The deploy ships whatever is in `apps/web` at that moment, so unfinished web work goes live with the next run that changes the index.
- Dollars and buried show "—" for bills that are not x-rayed: CBO's per-bill deficit is only read from the x-ray tables, so a big bill outside the top 25 on the cheap score (moving, size) could be missed. Raising `ANTIBODY_WATCH_ENRICH` widens that.
- Not covered: simple resolutions (H.Res., S.Res.) never become law and are left out on purpose; floor action by voice vote or unanimous consent is not counted as rushed.
