# ingest-trades: results

Stage `trades` (global, writes `ptr_documents` + `trades`). Reads House PTRs 2019-2026 and Senate eFD PTRs filed since 2019-01-01. Run: `bun run antibody run trades` (cached downloads and vision reads are reused). Env: `ANTIBODY_VISION_PAGES` (pages per run, default 200), `ANTIBODY_VISION_SINCE` (ISO floor), `ANTIBODY_VISION_WORKERS` (default 4), `ANTIBODY_VISION_MODEL` (default `claude-sonnet-5-5`).

## What it produced (2026-10-14)

| | |
|---|---|
| Filings | 5,786 (House 4,567, Senate 1,219): 5,482 read, 43 partly read, 261 unread |
| Trades | 100,984, each with owner, type, dates, amount range, filing URL with `#page=N`, row locator |
| By reader | House text layer 39,317 · Senate HTML 8,900 · vision 52,767 (House 50,859, Senate 1,908) |
| Owner | self 24,340 · spouse 39,127 · joint 15,500 · dependent 22,017 (never blank) |
| Flagged for a second read | 4,592 vision rows (all still flagged in the data) |

Vision is 52% of all rows because the two heaviest traders on paper (Khanna, McCaul) file hundreds of pages of family-account trades; their spouse/dependent rows are the bulk of the owner counts.

## Vision step: cost and time

- First 50-page measurement (before any tuning): 48 pages, 68 calls, $5.88, 499 s wall at 4 workers, 574 rows; 70 rows flagged uncertain, 20 cells rechecked.
- Whole run: 3,619 pages read, about 6,900 model calls, $246 API-equivalent (about $0.07 a page, run on a Max plan), mean call 12.6 s, 4 workers ran about 10 pages a minute.
- Model: Sonnet 5.5 through `claude -p` with the page image (Bassim's Oct 13 switch from Opus). 692 of the first 1,543 pages came back sideways; the page is turned upright from the model's own `rotation` answer and read again.
- Second read: a cell the model marks unreadable is checked again on a fresh look at the same image. Of 2,020 rechecked cells, 1,358 agreed, 213 changed, 449 the page itself does not allow reading. A recheck replaces a first reading only when the first had unreadable characters; the row stays flagged (`needs_second_read`, confidence 0.5-0.75) either way.
- Rows with no readable date or amount are flagged too.
- Hand check: McCaul 2021 page 2 (31 rows, 7 fields each) matched the image cell for cell, including the checkbox grid and the "SP" owner column.

## What was not read, and why

- 261 filings, about 1,000 pages, are unread. I ran filers who sponsored or cosponsored an ingested bill first (done except 19 filings, which stay `partial` because some rows had no readable owner or type), then the newest pages first. The rest is Khanna 2020-2022 and similar old paper filings.
- The daily run (`ANTIBODY_VISION_PAGES`) keeps reading the rest and new paper filings; `read_status` on `ptr_documents` drives the "paper filings not yet read" gap.
- 868 vision rows had no readable owner or type and were not stored (listed per document by the run's `dropped` output). Their documents read `partial`.
- 927 trades have no ISO traded_on (the date stays in `raw` as filed); 305 have no amount range (mostly brokerage-statement attachments with no amounts).

## Choices that matter downstream

- Spouse/joint/dependent trades stay under the member with `owner`. A blank owner cell means the filer, as both forms' instructions say.
- Re-filed and amended trades collapse to one row (the latest filing wins).
- Senate paper owner codes (S/J/DC), dashed dates, D-Mon-YY dates and the form variants "$1,000 - $15,000" and "$1,0001 - $15,000" map to the statutory range (the printed lower bound is replaced by the bucket's floor, the printed text stays in `amount`).
- Values are never "fixed" otherwise: the as-read cell and any recheck are kept in `raw`.

## Fixed this round

- Four Senate paper filings (Boozman, Blumenthal) had no images because the image tag has `style` before `src`; now matched, tested.
- `$1,0001` typo, `26-Oct-22` dates, incomplete vision rows flagged.

## Blockers

None. Note for the watcher: the vision step needs `claude` on PATH and a Claude plan with room (about 1.9 calls a page: one read, one more for sideways pages or rechecks).
