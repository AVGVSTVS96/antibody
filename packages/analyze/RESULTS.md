# attention (ingest-news + analyze)

Per-section news attention and the buried score, for any bill, with the same rules for every party. Two packages: `ingest-news` (outlets, articles) and `analyze` (attention, section_scores). Stages: `outlets` -> `news` -> `attention` -> `scores`.

## What ran, on which source

- **Media Cloud** (free account, hex-ai@agentmail.to, token in `.env` as `MEDIACLOUD_API_KEY`) supplied every article for every bill below (`via` = mediacloud on all rows). Google News RSS (`ingest-news/src/gnews.ts`) is the fallback when there is no key or Media Cloud fails; it was not needed. Each attention row records `via`, so a bill built on the fallback says so.
- Search: terms and window per bill in `ingest-news/data/queries.json` (the bill's short title and press name; a bill not listed is searched by its BILLSTATUS short title and number). Media Cloud allows 2 searches a minute, so a bill takes about 3 minutes to fetch.
- Reading: up to 150 articles per side and 60 trade/legal, picked by a fixed hash (the same ones on every re-run), fetched and cleaned with trafilatura. Articles under 1,000 readable characters (paywall stubs) are not counted, so a paywall cannot shrink one side.

## The outlet list (published, fixed)

`packages/ingest-news/data/outlets.json`, version `2026-10`, 86 outlets: left 12, center-left 16, center 10, center-right 1, right 19, trade/legal 28. Groups are Media Cloud's 2019 US partisanship quintiles (whose followers shared the outlet), midpoint when an outlet sits in several; the rule and the 5 collection URLs are in the file, and 11 outlets that were rated but not collected are listed as left out. The table `outlets` carries it, versioned.

Left (left + center-left), center and right (center-right + right) each weigh one third, so no side counts more for having more outlets or more stories. A side with under 10 relevant readable articles is dropped from the weighting and named as a gap; a bill with under 20 relevant articles shows no percentiles. Trade and legal coverage is counted separately (`trade_legal_hits`) and never enters the score.

## Per-section attention

A `claude -p --model sonnet` matcher reads each article (first 900 words, headline, no outlet name) and a menu of the bill's final-and-earlier sections, and answers: is the bill a main subject, a mention, or unrelated; which section numbers it discusses; whether it is about the whole bill; and if the fight is outside the text, what about (the "outside the text" lane). Big bills (over 40 sections) show each article a shortlist (15 by local embeddings plus 12 by heading-word and initialism overlap) (IRS -> Internal Revenue Service), so the model never reads 800 headings. If `claude -p` is unavailable the stage falls back to local embeddings only and the rows say so (`matcher`, `model` in `evidence`). Everything is cached by matcher version and menu hash; failed batches retry 5 times and an incomplete run throws instead of dropping articles.

Row = `attention` table, an inference: rule `attention-v1`, confidence 0.75 (0.4 when thin), `rests_on` the articles, with 3 example articles (one per side first) and `hits_by_group`. A section's attention is the balanced share of relevant articles that discuss it, ranked as a percentile among the bill's final sections; uncovered sections all rank 0.

## Late adds

Not detected here. `section_scores.late` is read from the bills lineage (`sections.late`), as decision `fix-late-flag` requires.

## The buried score, in plain words

Every constant is in `analyze/src/score.ts` and printed in the published rule (`SCORE_TEXT`, version `buried-v2`):

1. **Stakes** (0 to 1): the larger of dollars and lobbying. Dollars = CBO's 10-year estimate for the section, log scale ($1M = 0, $1B = 0.5, $1T = 1; cuts and costs count the same), current-law baseline, baseline named on the row. Lobbying = number of lobbying reports naming the section, log scale (1 = 0.15, 10 = 0.52, 100 = 1).
2. **Costly** = stakes of at least two thirds: $10B in CBO's figure for the section itself (an even share of a CBO group line never counts), or 21 lobbying reports.
3. **Quiet** = under 1 in 100 of the bill's relevant articles (left, center and right weighted equally) discuss the section. It runs from 1 (none did) to 0 (1 in 100 or more). Before a costly section is called quiet it gets the `quiet-check` second look (below).
4. **Sneak** = 1 + up to 0.25 if the section was late (times the share of the bill that was NOT late) + 0.25 x off-topic distance (only in a bill with one committee title). It ranks the buried sections; it is not needed for the label.
5. **Buried score** = stakes x quiet x sneak (0 to 1.5): the order of the buried list.
6. **Label.** `headline`: top tenth of the bill by attention with at least 3 articles. `buried`: costly and quiet, in a bill of at least 10 sections. Everything else `normal`.

buried-v1 also required the section to be late, or off-topic in a bill with one committee title. Late is withheld on every bill that began as a shell and off-topic never counts in a bill built from several titles, so v1 could not fire on 14 of 22 bills, and on the rest it needed a section to be late as well as quiet and costly.

**Can't be tested** (the page says which, never a bare zero): fewer than 10 sections; news too thin to rank the sections (under 20 relevant articles or 30 section mentions); no section with a measured cost (CBO gave no section its own figure and no section is named in 21 lobbying reports).

### The second look (`quiet-check`, rule `quiet-check-v1`)

The matcher assigns each article to sections from a shortlist, so a provision the press words differently reads as untouched (IRA's Part D "benefit redesign" is the "$2,000 cap" in news copy: 11+ articles, 1 matched). For each costly section under 1 article in 100, a model restates the provision in news words and lists phrases; the 8 passages that use those phrases, or sit closest in meaning (one per article), go back to the model, which says which describe the provision. The articles it names are added and the share is worked out again. Only costly sections are checked, so it can take a buried label away but never give one, and it does not touch attention percentiles or headlines. Rows: `attention_checks`.

## Same rules for every party: what was checked

- The formula has no input for party, sponsor or outlet lean (test: same components give the same score). Swapping the left and right outlet lists changes nothing (test). A side with more or fewer articles weighs the same (test). Short articles are not counted (test).
- `scripts/fairness.ts <bill...>` prints, per side: articles read, average length, share about the bill, sections per article, and per bill the label rates. Run on 8 bills:

| bill | sponsor party | final sections | headline | buried | articles read L / C / R |
|---|---|---|---|---|---|
| OBBBA (119-hr-1) | R | 310 | 9% | 7% | 136 / 78 / 110 |
| GENIUS (119-s-1582) | R | 20 | 10% | 0% (no per-section $) | 127 / 92 / 60 |
| Safer Communities (117-s-2938) | R | 32 | 13% | 3% | 70 / 33 / 44 |
| SAVE Act (119-hr-22) | R | 8 | 13% | 0% (no per-section $) | 97 / 17 / 95 |
| IRA (117-hr-5376) | D | 153 | 10% | 1% | 99 / 42 / 112 |
| American Rescue Plan (117-hr-1319) | D | 217 | 10% | 0% | 77 / 52 / 71 |
| Infrastructure (117-hr-3684) | D | 632 | 1% | 0% (no per-section $) | 75 / 44 / 94 |
| CHIPS vehicle (117-hr-4346) | D | 267 | 2% | 0% (no per-section $) | 86 / 41 / 102 |

  Headline rate sits near 10% in both parties' bills by construction; the buried rate is rare everywhere and moves with data availability and each bill's own late/rewrite structure (OBBBA is the one bill with large per-section CBO dollars and an unusually large late share), not with party. With 3 per party that is not proof; it is a check that nothing in the pipeline is party-shaped, and the numbers are reproducible with the script.
- **Real asymmetry found, and what is done about it:** right-leaning outlets' articles are shorter (about 4.3k characters against 7.3k on the left for IRA) and name fewer sections per article (IRA 0.38 against 1.38; IIJA 0.06 against 0.59), so per-side shares differ in size. Sensitivity check: normalizing each side by its own most-covered section instead moves the top-decile set by 1 of 16 sections on IRA, 3 of 29 on OBBBA and none on GENIUS, so the equal-weight rule is kept and the per-side numbers stay visible (`hits_by_group`, `evidence`).
- Late-add flags come from the lineage; shell vehicles (S.2938, H.R.4346: 97% and 100% "late", because the real text arrived in a later version) shrink the late bonus to near zero by the share-of-bill rule instead of marking every section sneaky.

## Cost and speed

Sonnet 5.5 through `claude -p`, no API key. A bill costs about $2 to $5 in API-equivalent terms (OBBBA $4.94 for 375 articles in 46 calls; GENIUS $4.57 for 319; Laken Riley $0.15 on cached re-run) and 10 to 20 minutes at 4 calls in parallel at nice 15. Off-topic distance runs locally.

## Known gaps

- Section assignment is the soft part. Whether an article is about the bill agrees 96% between Sonnet and Opus on GENIUS (93 articles); which section it names agrees only 0.25 Jaccard where either named one, because most articles name none or one. That is why attention rows are labeled inferences with confidence 0.75 and carry example articles to read.
- Media Cloud's partisanship quintiles are 2019 and Twitter-follower based; the center-right group has one outlet. The list is published and versioned so it can be argued with and changed.
- A matched article's text is the first 900 words, so a section discussed late in a long piece can be missed on every side alike.
- Bills with no per-section CBO figure cannot get a `buried` label (above).
- 118-hr-3746 (Fiscal Responsibility Act) is in `queries.json` but its sections are not ingested yet, so attention could not run on it; the stage will run once the bills stage has produced its sections.
- The registry test in `apps/cli` fails on this branch alone because `news` needs `bills`, which only exists after the bills branch is merged; with p1/bills merged it passes up to the other parts' stages.
