# ingest-cbo

Any bill -> its CBO estimates -> per-section dollars, each named with its baseline and cited to a cell range or PDF page.

## Stages

| stage | scope | needs | writes |
|---|---|---|---|
| `cbo` | bill | the bills section stage | `cbo_estimates`, `cbo_lines` |
| `cbo-notes` | bill | `cbo`, bills | `cbo_notes` |

`cbo` reads the estimates BILLSTATUS lists (congress.gov links), fetches each publication's files from the Internet Archive (cbo.gov blocks scripts; every row cites the cbo.gov URL and stores the archive copy as `archive_url`), and picks the richest table a publication has: per-title Excel (one file or one per committee, merged), then per-section, per-title or per-provision PDF tables, then a small bill's `table1.xlsx`, then the PDF's printed summary. The At a Glance box and mandate answers come from the PDF either way. A bill with no estimate of its own also reads the estimates of bills BILLSTATUS names as carrying the same text (an identical bill, a public law that contains its text, or a related bill with its short title); the line's `source_locator` names that bill.

## What it guarantees

- Every estimate names its baseline: `current-law` or `current-policy` (the Senate budget-enforcement baseline), with a label that carries CBO's baseline month when it prints one. Current-policy figures sit beside current-law ones as separate estimates (H.R.1 has 5 current-policy and 4 current-law estimates).
- Rows are checked against CBO's own printed totals for every title, block, measure and period (H.R.1 and IRA reconcile exactly: 312/312, 216/216), and against a printed division total where there is one. A block whose rows don't add up is not shown as sections; its total appears as a `group` line that says why. A block of title or provision rows with no printed total to check it by is left out (a block of one row stands). Tables printed in billions to one decimal are read in millions, may be $100M off their total, and say so in the citation.
- `join` says how a row was tied to sections. `number`: CBO printed the section number (in the row, or in a footnote on it) and the section's heading fits CBO's label. `heading`: CBO printed no number; the row's label holds all or most of one section's heading under the division and title it sits in, with a clear margin over every other heading there, and no other row claims that section. `title`: CBO printed the figure for a whole title or division (or its text says which); the sections are all of those under it. `heading` and `title` are inferences, and `source_locator` says what they rest on.
- A CBO line covering several sections is stored as a `group` line (exact). Each section under it gets an `even_split` line that rests on the group line (`rests_on`): an inference, since CBO never made that split. Signs are kept. A group over more than `EVEN_SPLIT_MAX` (8) sections, printed by CBO or a whole title, stays a group line.
- Section numbers repeat across the divisions of an omnibus bill, so a table that names its division joins only to that division's section, and the lines of a division table are `sA.102`, `sB.102`.
- A derived deficit line rests on the outlay and revenue lines it adds up and cites every cell range of both.
- `spending` says direct or discretionary; discretionary tables and blocks (S.2938 Division B, H.R.4 rescissions, FRA's caps and Nonrecurring Expenses Fund) are not turned into section lines.
- CBO section numbers join to bill sections through the lineage path of the version CBO scored. When CBO scored text GovInfo never published (a committee print, a Senate amendment), the published version whose numbering contains at least 95% of CBO's numbers (and at least 5 of them) is used, and each affected line's `source_locator` says so.
- `cbo-notes` (small bills with no per-section table): a model (Sonnet 5.5; earlier cached answers stay marked Opus 5.5 in `evidence.model`) links CBO's sentences to sections. A link is kept only when the quote is found word for word on the cited PDF page, the section exists in the scored version and the model's confidence is at least 0.5. Each is an inference quoting CBO's sentence and page.

## Runs (data/out, this machine)

| bill | estimates | lines | section lines | joined to a section | even-split lines | sections with a deficit figure |
|---|---|---|---|---|---|---|
| 119-hr-1 (OBBBA) | 9 | 4265 | 4226 | 4026 | 108 | 295 (was 288) |
| 117-hr-5376 (IRA) | 31 | 1146 | 1121 | 1117 | 46 | 141 (was 136) |
| 117-hr-2617 (CAA 2023) | 4 | 321 | 296 | 296 | 36 | 99 (was 45) |
| 117-hr-3684 (IIJA) | 2 | 165 | 102 | 102 | 55 | 33 (was 0) |
| 117-hr-4346 (CHIPS and Science) | 1 | 22 | 17 | 17 | 6 | 6 (was 0) |
| 118-hr-3746 (Fiscal Responsibility Act) | 1 | 31 | 19 | 19 | 15 | 6 (was 0; 1 non-zero) |
| 119-s-1071 (NDAA FY2026) | 1 | 23 | 21 | 15 | 0 | 5 (was 0) |
| 117-s-3373 (PACT Act, via H.R.3967) | 3 | 25 | 6 | 6 | 0 | 2 (was 0) |
| 117-s-2938 (Safer Communities) | 1 | 32 | 29 | 29 | 10 | 10 (was 7) |
| 119-s-1582 (GENIUS) | 1 | 5 whole-bill + 7 prose links | 0 | 0 | 0 | 0 |

GENIUS prose links: 12 proposed, 7 kept, $0.17 and 15s on Sonnet (the Opus run proposed 24, kept 9, $0.49).

## Known gaps

- Many of IRA's 31 estimates are House Rules Committee or Senate Democratic Leadership drafts with no table to read or a Notes-only sheet; they yield 0 lines. The enacted estimate (58455) and the Senate substitute (58366) carry the section numbers.
- `cbo-notes` needs the scored version's code, so a small bill whose estimate scored unpublished text gets whole-bill numbers only.
- PDF layout differs by CBO analyst. IRA, OBBBA, S.2938, CHIPS, IIJA, CAA, NDAA and PACT-style PDFs parse; a bill with a different layout falls back to the PDF summary or `table1.xlsx`, and if neither parses it has an estimate row and no lines. The parse step prints which.
- IIJA: the program rows that are not section headings ("Contract Authority for Programs Funded by the Highway Trust Fund", $150B) stay group lines, and titles of more than 8 sections (Federal-Aid Highways) are not split. The estimate scored the August 1 amendment; its sections are joined to the Senate-passed text (`eas`), which differs in places.
- A title-level row (CAA Division T title I and III revenues, IIJA division D title V) that covers more than 8 sections has no per-section figure. A small title's even share is added to sections of that title that CBO also priced on their own (S.2938 12004, 12005), which turns their deficit figure into an even-split one.
- FRA: SNAP work requirements (+$2.1B) and the rescission of unobligated balances (-$27.1B budget authority) are tied only to their division or title (more than 8 sections), so they stay group lines. Only the IRS rescission (section 251) is a single-section figure. Discretionary lines (the caps, the $22B Nonrecurring Expenses Fund) are not section lines.
- PACT (S.3373): the House-version estimates of H.R.3967 (57669, 57886) give no usable lines; the Senate-version estimate (58177) names sections 804 and 806 in its footnotes; the $116.8B and $396.6B reclassification of discretionary spending (section 805) is a group line because 805's heading doesn't fit the row's label.
- Some wrapped section titles lose a trailing word where PDF text overlaps ("Firearms Act"); titles shown on the site come from the bill text, not CBO's.
