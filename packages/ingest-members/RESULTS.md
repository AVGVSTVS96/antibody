# money part: members, committees, votes, FEC money

**Done.** `ingest-members` and `ingest-fec` fill 9 contract tables from primary public records, for any bill, through the CLI. They run on GENIUS (119-s-1582), OBBBA (119-hr-1) and the IRA (117-hr-5376). Every row carries a specific record URL. Vote tallies match the House Clerk and senate.gov to the vote, and a PAC sum matches the verifier's hand check to the dollar.

```
congress-legislators ──► members (bioguide ↔ FEC ↔ LIS, dated terms)
   │  pinned commit    ──► committees, committee_members (per Congress)
GovInfo BILLSTATUS ──► recorded votes ──► Clerk / senate.gov XML ──► roll_calls, member_votes
FEC bulk pas2 ──► contributions (24K/24Z) · independent_expenditures (24E/24A) ──► pacs (cm)
FEC bulk indiv ──(streamed, 2-6 GB zips)──► employer_contributions (per member, cycle, employer)
```

## Stages

| stage | scope | writes (shard) | source |
|---|---|---|---|
| `members` | global | members (`legislators`), committees (`legislators`, upserted) | unitedstates/congress-legislators |
| `committee-members` | bill | committee_members (`<congress>`), retired subcommittees into committees | that file's git history, pinned to a commit |
| `votes` | bill | roll_calls, member_votes (`<chamber>-<congress>-<session>`, upserted, so bills share a session) | BILLSTATUS `recordedVote` → House Clerk / senate.gov XML |
| `fec` | bill | contributions, independent_expenditures (`pas2-<cycle>`), pacs (`cm`) | FEC bulk pas2 + cm |
| `fec-employers` | bill | employer_contributions (`indiv-<cycle>`) | FEC bulk indiv + ccl + cn, run memory-capped in its own process |

A bill's cycles are the one that seated its Congress and the one it serves in: 119th → 2024 and 2026, 117th → 2020 and 2022 (`cyclesFor`). Each cycle and each Congress roster is fetched once and cached; `--refresh` refetches. A bill GovInfo hasn't published BILLSTATUS for yet logs and skips instead of failing `xray`.

## What the data holds now

| table | rows | note |
|---|---|---|
| members | 1,916 | everyone serving since 1993 |
| committees | 570 | current, historical, and 11 retired subcommittees read from the roster's own commit |
| committee_members | 15,565 | 116th-119th; every seat resolves to a committee row |
| roll_calls | 100 | GENIUS 10, OBBBA 47, IRA 43 (bill and amendment votes) |
| member_votes | 12,661 | 0 unmatched voters |
| pacs | 7,455 | committees that gave to or spent on a member, 2020-2026 |
| contributions | 1,737,802 | one row per FEC transaction, 2020-2026 |
| independent_expenditures | 138,424 | 2020-2026, about 1 in 10 undated in FEC's file |
| employer_contributions | 633,469 | 2020: 190,570, 2022: 181,726, 2024: 164,440, 2026: 96,733 (employer, member, cycle sums of $1,000 or more) |

## Checked against the source

- **Votes, tallied by the party each member had on the vote's date** (`termOn`):
  - IRA Senate passage (senate-117-2-325): 48 D + 2 I caucusing D yea, 50 R nay. The result reads "Bill Passed (tie broken by the Vice President of the United States, voting Yea)".
  - OBBBA: Senate 372 is 50 R yea; 45 D, 2 I and 3 R nay. House 190 (concur) is 218 R yea; 212 D and 2 R nay.
  - GENIUS: House 200 is R 206-12 and D 102-110, the Clerk's own totals by party. Senate 318 is 68-30 with 2 not voting. Rep. Cisneros is Nay, as the verifier found.
- **Committees:** Debbie Stabenow chairs SSAF in the 117th roster and Adam Schiff chairs HLIG in the 116th, as recorded.
- **PAC money:** HBI-PAC → Casten is 2,000 + 2,500 + 2,000 + 2,000 = $8,500, the same as the verifier's hand sum. Each row cites its own filing image.
- **Employer sums vs the FEC API.** For Hagerty / Coinbase in 2024, the bulk sum is $13,335 from 3 contributions. The API's `by_employer` gives $18,335 from 13, because it also counts memo lines: redesignation pairs like +$3,300 / −$3,300 for one donor. Tractor Supply is $31,841 against the API's $28,541, where the API keeps only the −$3,300 half of one redesignation. We follow FEC's rule that memo lines are not summed, and every row says so in its locator.

## Decisions (same rule for every party and member)

- **Party at the time.** `members.terms` keeps every term and splits mid-term switches (Sinema, Manchin, Van Drew, Kiley), with `caucus` for independents. The row's own `party` is the latest one. If you tally by `members.party`, Sinema and Manchin show as I on the IRA vote, so store reads the term instead (the bundle part already does).
- **Direct money vs outside money.** `contributions` holds only 24K (cash) and 24Z (in-kind), the money given to the campaign. Super PAC and party spending for (24E) or against (24A) a member goes in the new `independent_expenditures` table. It is never summed into a `funded` edge.
- **Employer sums.** These are itemized individual contributions to a member's principal and authorized campaign committees, types 15, 15E (earmarked through ActBlue/WinRed) and 15J, with memo lines left out. Employer spellings are grouped by one key: upper case, "&" as AND, punctuation dropped, a leading THE and trailing legal suffixes removed. Answers that name no organization are counted but not written: retired, not employed, self-employed, N/A, "information requested". That was 78% of 2024 contributions ($637M). A row is written when an employer's total to one member in one cycle reaches **$1,000** (`EMPLOYER_MIN_USD`). In 2026 that keeps 40% of groups and 86% of the dollars. The row cites a fec.gov query that reproduces the sum, plus the filing image of the largest contribution.
- **Rosters per Congress.** Each roster comes from the congress-legislators membership file at a pinned commit. For the current Congress that's the latest commit, cited to the Clerk or senate.gov roster page. For a past Congress it's the last full roster before the file was cleared at the Congress's end, cited to the GitHub blob at that commit. The locator always names the date and commit. One seat per member per committee: the 116th file lists Fred Keller twice on HSED.
- **Ids.** A roll call is `senate-119-1-318`, the format bills' `amendments.roll_id` already uses. A seat is `<congress>:<committee>:<bioguide>`, a member vote is `<roll>:<bioguide>`, an employer sum is `<cycle>:<bioguide>:<KEY-WITH-DASHES>`, and FEC rows use FEC's SUB_ID. `committeeId("ssbk00") = "SSBK"` matches the bills part's Thomas codes.

## Contract changes (additive, in core with tests)

- `members.terms[]`: {chamber, start, end, state, district, party, caucus}
- `contributions.recipient_committee_id`: the campaign committee that got the money. `givingUrl(pac, recipient, candidate, cycle)` builds the fec.gov list of every payment from that PAC to that campaign in the cycle, narrower than the store's current `allTxnsUrl`, which lists all of the PAC's disbursements.
- New `independent_expenditures` table (pac_id, bioguide, candidate_id, support|oppose, amount_usd, date nullable, cycle).
- New `employer_contributions` table (bioguide, cycle, committee_ids, employer, employer_key, spellings, amount_usd, contributions, first, last, largest_usd, largest_url).

## Not done, and why

- **Sponsors and cosponsors** belong to `sponsorships`, which ingest-bills owns. The bills part writes them from its own BILLSTATUS parse with the same ids (`<bill>:<bioguide>`). I built a stage for it, then removed it once p1/bills landed, so there's no duplicate.
- **congress.gov beta House votes** need an api.data.gov key, which we don't have. The Clerk XML is the primary record anyway, and it covers the House back to 1990.
- **Graph edges** (`voted`, `member_of`, `funded`) and claim text come from store (p1/bundle), which already reads `terms`. Nothing for outside spending reaches the bundle yet. It needs an edge kind, which is store's call; the rows are ready.
- **Leadership PACs** (designation D) are kept with their designation, so resolve can skip "connected org = the member's surname", the spike's WILLIAMS / MCCORMICK error. Individual money to a member's leadership PAC isn't summed by employer; only campaign committees are.
- **Rosters change mid-Congress.** A roster is one snapshot per Congress. A bill marked up early in a Congress can show a later roster for the current one, and the locator says which date.

## Run it

```
bun run antibody run votes 119-s-1582          # members first, then roll calls
bun run antibody run committee-members 117-hr-5376
bun run antibody run fec 119-hr-1               # ~15 s per pair of cycles
bun run antibody run fec-employers 119-hr-1     # ~2-4 min per cycle, under a 4G cap (peak ~1 GB)
bun test packages/ingest-members packages/ingest-fec
```

Tests use real records: Clerk and senate.gov roll XML snippets, Sinema's party switch, and tiny zipped FEC bulk files with Rep. Casten's PAC and individual lines plus memo, undated and non-employer edge cases.
