# ingest-cbo

Any bill -> its CBO estimates -> per-section dollars, each named with its baseline and cited to a cell range or PDF page.

## Stages

| stage | scope | needs | writes |
|---|---|---|---|
| `cbo` | bill | the bills section stage | `cbo_estimates`, `cbo_lines` |
| `cbo-notes` | bill | `cbo`, bills | `cbo_notes` |

`cbo` reads the estimates BILLSTATUS lists (congress.gov links), fetches each publication's files from the Internet Archive (cbo.gov blocks scripts; every row cites the cbo.gov URL and stores the archive copy as `archive_url`), and picks the richest table a publication has: per-title Excel (one file or one per committee, merged), then per-section PDF tables, then a small bill's `table1.xlsx`, then the PDF's printed summary. The At a Glance box and mandate answers come from the PDF either way.

## What it guarantees

- Every estimate names its baseline: `current-law` or `current-policy` (the Senate budget-enforcement baseline), with a label that carries CBO's baseline month when it prints one. Current-policy figures sit beside current-law ones as separate estimates (H.R.1 has 5 current-policy and 4 current-law estimates).
- Section rows are checked against CBO's own printed totals for every title, block, measure and period (H.R.1 and IRA reconcile exactly: 312/312, 216/216). A block whose rows don't add up is not shown as sections; its total appears as a `group` line that says why.
- A CBO line covering several sections is stored as a `group` line (exact). Each section under it gets an `even_split` line that rests on the group line (`rests_on`): an inference, since CBO never made that split. Signs are kept.
- A derived deficit line rests on the outlay and revenue lines it adds up and cites every cell range of both.
- `spending` says direct or discretionary; discretionary tables (S.2938 Division B) are not turned into section lines.
- CBO section numbers join to bill sections through the lineage path of the version CBO scored. When CBO scored text GovInfo never published (a committee print, a Senate amendment), the published version whose numbering contains at least 95% of CBO's numbers (and at least 5 of them) is used, and each affected line's `source_locator` says so.
- `cbo-notes` (small bills with no per-section table): a model (Sonnet 5.5; earlier cached answers stay marked Opus 5.5 in `evidence.model`) links CBO's sentences to sections. A link is kept only when the quote is found word for word on the cited PDF page, the section exists in the scored version and the model's confidence is at least 0.5. Each is an inference quoting CBO's sentence and page.

## Runs (data/out, this machine)

| bill | estimates | lines | lines joined to sections | even-split lines |
|---|---|---|---|---|
| 119-hr-1 (OBBBA) | 9 | 4265 | 4161 | 108 |
| 117-hr-5376 (IRA) | 31 | 1145 | 1121 | 46 |
| 117-s-2938 (Safer Communities) | 1 | 22 | 21 | 0 |
| 119-s-1582 (GENIUS) | 1 | 5 whole-bill + 7 prose links | 0 | 0 |
| 117-hr-4346 (CHIPS) | 1 | 2 whole-bill | 0 | 0 |

GENIUS prose links: 12 proposed, 7 kept, $0.17 and 15s on Sonnet (the Opus run proposed 24, kept 9, $0.49).

## Known gaps

- Many of IRA's 31 estimates are House Rules Committee or Senate Democratic Leadership drafts with no table to read or a Notes-only sheet; they yield 0 lines. The enacted estimate (58455) and the Senate substitute (58366) carry the section numbers.
- `cbo-notes` needs the scored version's code, so a small bill whose estimate scored unpublished text (CHIPS) gets whole-bill numbers only.
- PDF layout differs by CBO analyst. IRA, OBBBA-style and S.2938-style PDFs parse; a bill with a different layout falls back to the PDF summary or `table1.xlsx`, and if neither parses it has an estimate row and no lines. The parse step prints which.
- Some wrapped section titles lose a trailing word where PDF text overlaps ("Firearms Act"); titles shown on the site come from the bill text, not CBO's.
